import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextModelError, type TextRequest } from '../../src/kernel/index.ts';
import { type TextStep } from '../brain/helpers.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

const SETTINGS = '/v2/translate/settings';
const PAGE = 'https://field-notes.dev/agents/what-to-remember';

function items(request: TextRequest): { id: string; text: string }[] {
  const user = request.messages.find((message) => message.role === 'user');
  return (JSON.parse(String(user?.content)) as { items: { id: string; text: string }[] }).items;
}

const echo: TextStep = async (request) => {
  const translated = items(request).map((item) => ({ id: item.id, text: `译：${item.text}` }));
  return { text: JSON.stringify({ items: translated }), complete: true };
};

function body(extra: Record<string, unknown> = {}) {
  return { pageUrl: PAGE, target: 'zh-CN', priority: 'visible',
    items: [{ id: 'p1', text: 'Most agents forget everything.' }, { id: 'h2', text: 'Remember decisions' }], ...extra };
}

test('翻译接口要登录；译完同一段再要走缓存', async () => {
  const app = await startTestApp([echo]);
  try {
    assert.equal((await call(app, 'POST', '/v2/translate', { body: body() })).status, 401);
    assert.equal((await call(app, 'GET', SETTINGS)).status, 401);
    const cookie = await pair(app);
    const first = await call(app, 'POST', '/v2/translate', { cookie, body: body() });
    assert.equal(first.status, 200);
    assert.deepEqual(json(first)['items'], [
      { id: 'p1', text: '译：Most agents forget everything.', cached: false },
      { id: 'h2', text: '译：Remember decisions', cached: false }]);
    assert.equal(json(first)['failure'], null);
    const again = await call(app, 'POST', '/v2/translate', { cookie, body: body() });
    assert.deepEqual((json(again)['items'] as { cached: boolean }[]).map((item) => item.cached), [true, true]);
    assert.equal(app.requests.length, 1);
  } finally { await app.close(); }
});

test('付款类页面不翻：不调模型，回一句原因；一批超过字数上限是 400', async () => {
  const app = await startTestApp([echo]);
  try {
    const cookie = await pair(app);
    const paying = await call(app, 'POST', '/v2/translate', { cookie,
      body: body({ pageUrl: 'https://shop.example.com/checkout?step=2' }) });
    assert.equal(paying.status, 200);
    assert.deepEqual(json(paying)['items'], []);
    assert.equal((json(paying)['failure'] as { code: string }).code, 'payment_page');
    assert.deepEqual((json(paying)['failure'] as { ids: string[] }).ids, ['p1', 'h2']);
    assert.equal(app.requests.length, 0);
    const big = Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, text: 'x'.repeat(3_500) }));
    assert.equal((await call(app, 'POST', '/v2/translate', { cookie, body: body({ items: big }) })).status, 400);
    assert.equal((await call(app, 'POST', '/v2/translate', { cookie,
      body: body({ pageUrl: 'javascript:alert(1)' }) })).status, 400);
  } finally { await app.close(); }
});

test('额度用完：回 200 和没译成的段、一句原因与几点能再试', async () => {
  const app = await startTestApp([new TextModelError('quota', '额度用完', '2026-10-27T10:00:00.000Z')]);
  try {
    const cookie = await pair(app);
    const reply = await call(app, 'POST', '/v2/translate', { cookie, body: body() });
    assert.equal(reply.status, 200);
    const failure = json(reply)['failure'] as { code: string; message: string; ids: string[]; retryAt: string };
    assert.equal(failure.code, 'quota');
    assert.match(failure.message, /^模型额度用完了，\d{2}:\d{2} 重置后能再试。$/);
    assert.deepEqual(failure.ids, ['p1', 'h2']);
  } finally { await app.close(); }
});

test('翻译设置：默认中文 · 双语对照 · 用词表开；网站规整成主机名并去重，旧版本写入 409 不覆盖', async () => {
  const app = await startTestApp([echo]);
  try {
    const cookie = await pair(app);
    const initial = json(await call(app, 'GET', SETTINGS, { cookie }));
    assert.deepEqual(initial, { version: 0, target: 'zh-CN', display: 'bilingual', glossary: true, alwaysSites: [] });
    const saved = await call(app, 'PUT', SETTINGS, { cookie, body: { ...initial, display: 'translation',
      alwaysSites: ['www.x.com', 'x.com', 'news.ycombinator.com'] } });
    assert.equal(saved.status, 200);
    assert.deepEqual(json(saved)['alwaysSites'], ['x.com', 'news.ycombinator.com']);
    assert.equal(json(saved)['version'], 1);
    const stale = await call(app, 'PUT', SETTINGS, { cookie, body: { ...initial, glossary: false } });
    assert.equal(stale.status, 409);
    assert.equal(json(await call(app, 'GET', SETTINGS, { cookie }))['glossary'], true);
    assert.equal((await call(app, 'PUT', SETTINGS, { cookie, body: { ...initial, target: 'xx' } })).status, 400);
  } finally { await app.close(); }
});

test('用词表开着时把在用的词带进提示，设置里关掉就不带', async () => {
  const app = await startTestApp([echo]);
  try {
    const cookie = await pair(app);
    app.state.agreements.importEffective({ kind: 'term', title: 'harness', text: '任务协作的外壳，译作「工作链」',
      scope: '', termTier: 'exact' }, app.clock.now().toISOString(), {}, '测试用词');
    const text = { items: [{ id: 'p1', text: 'A good harness matters.' }] };
    await call(app, 'POST', '/v2/translate', { cookie, body: body(text) });
    assert.match(app.requests[0]?.system ?? '', /工作链/);
    const current = json(await call(app, 'GET', SETTINGS, { cookie }));
    await call(app, 'PUT', SETTINGS, { cookie, body: { ...current, glossary: false } });
    await call(app, 'POST', '/v2/translate', { cookie, body: body(text) });
    assert.equal(app.requests.length, 2);
    assert.doesNotMatch(app.requests[1]?.system ?? '', /工作链/);
  } finally { await app.close(); }
});
