// /v2/spaces、/v2/subscriptions、/v2/review（《优化清单》第 6、7 条；第 8 批第 6 条起空间是整页网页）：
// 401 / 400 / 404 / 409 / 200，他在页面上改字、改名、撤销、「以后都这样」、开定时要先有样刊、现在出一期、首页回顾。

import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { REVIEW_SUBSCRIPTION_ID, researchDraft, writeSpace } from '../../src/subs/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(): Promise<{ app: TestApp; cookie: string }> {
  t = await startTestApp();
  return { app: t, cookie: await pair(t) };
}

const HTML = '<header class="rp-hero"><h1 class="rp-h1">睡眠中的记忆重放</h1><div class="rp-stats"><div class="rp-stat">'
  + '<div class="v"><b>14</b></div><div class="l">篇读过</div></div></div></header>'
  + '<section class="rp-sec" id="overview"><h2>本周概览</h2><p>重放越多越好。</p></section>';
const PAGE = { genre: 'report' as const, html: HTML };

function research(app: TestApp) {
  return app.state.subscriptions.create({ title: '认知与神经科学研究周报', kind: 'research', status: 'draft',
    timeZone: 'Asia/Shanghai', settings: researchDraft({ topics: ['睡眠'] }) });
}

test('没登录 401；读不存在的空间 404；列表里有空间和它的来路', async () => {
  const { app, cookie } = await start();
  assert.equal((await call(app, 'GET', '/v2/spaces')).status, 401);
  assert.equal((await call(app, 'GET', '/v2/spaces/nope', { cookie })).status, 404);
  const sub = research(app);
  writeSpace(app.state, { title: '马来西亚签证核查', ...PAGE }, 'ai');
  writeSpace(app.state, { title: '研究周报 · 第 1 期', ...PAGE, subscriptionId: sub.id }, 'ai');
  const list = json(await call(app, 'GET', '/v2/spaces', { cookie }))['spaces'] as Record<string, unknown>[];
  assert.deepEqual(list.map((item) => [item['title'], item['kind'], item['genre'], item['issueNumber']]),
    [['研究周报 · 第 1 期', 'research', 'report', 1], ['马来西亚签证核查', 'space', 'report', null]]);
});

test('他在页面上改字：存成新的一版、作者记他、再清洗一遍；版本过时 409；正文空了 400', async () => {
  const { app, cookie } = await start();
  const { space } = writeSpace(app.state, { title: '草稿', ...PAGE }, 'ai');
  const edited = HTML.replace('睡眠中的记忆重放', '我改的结论');
  const saved = await call(app, 'PUT', `/v2/spaces/${space.id}`, { cookie, body: { requestId: newRequestId(),
    version: 1, html: `${edited}<iframe src="https://x"></iframe>` } });
  assert.equal(saved.status, 200);
  assert.equal(json(saved)['version'], 2);
  assert.equal(json(saved)['author'], 'user');
  assert.equal(json(saved)['html'], edited);
  assert.equal(json(saved)['genre'], 'report');
  assert.equal((await call(app, 'PUT', `/v2/spaces/${space.id}`, { cookie, body: { requestId: newRequestId(),
    version: 1, html: HTML } })).status, 409);
  const bad = await call(app, 'PUT', `/v2/spaces/${space.id}`, { cookie, body: { requestId: newRequestId(),
    version: 2, html: '<p></p>' } });
  assert.equal(bad.status, 400);
  assert.equal((await call(app, 'POST', `/v2/spaces/${space.id}/assist`, { cookie, body: {} })).status, 404);
});

test('Plasticine 改了一期：页底有「改了什么」和规则；「以后都这样」写进订阅设置，「撤销」恢复上一版', async () => {
  const { app, cookie } = await start();
  const sub = research(app);
  const { space: issue } = writeSpace(app.state, { title: '第 2 期', ...PAGE, subscriptionId: sub.id }, 'ai');
  writeSpace(app.state, { id: issue.id, version: 1, title: '第 2 期', html: HTML.replace('睡眠中的', '改过的'),
    change: '图从 4 张减到 1 张', rule: '每期最多 1 张图' }, 'ai');
  const view = json(await call(app, 'GET', `/v2/spaces/${issue.id}`, { cookie }));
  assert.deepEqual(view['lastChange'], { version: 2, change: '图从 4 张减到 1 张', rule: '每期最多 1 张图',
    adopted: false });
  const subscription = view['subscription'] as Record<string, unknown>;
  const adopted = await call(app, 'POST', `/v2/subscriptions/${sub.id}/rules`, { cookie, body: {
    requestId: newRequestId(), version: subscription['version'], spaceId: issue.id, spaceVersion: 2 } });
  assert.equal(adopted.status, 200);
  const settings = json(adopted)['settings'] as { rules: { text: string; fromIssue: number }[] };
  assert.deepEqual(settings.rules.map((rule) => [rule.text, rule.fromIssue]), [['每期最多 1 张图', 1]]);
  const after = json(await call(app, 'GET', `/v2/spaces/${issue.id}`, { cookie }));
  assert.equal((after['lastChange'] as Record<string, unknown>)['adopted'], true);
  const undone = await call(app, 'POST', `/v2/spaces/${issue.id}/undo`, { cookie, body: {
    requestId: newRequestId(), version: 2 } });
  assert.equal(json(undone)['version'], 3);
  assert.equal(json(undone)['html'], HTML);
});

test('订阅：列表里个人回顾在前；没出样刊不能开定时（409）；出过以后开定时，有下一次的时间；暂停没有', async () => {
  const { app, cookie } = await start();
  const sub = research(app);
  const list = json(await call(app, 'GET', '/v2/subscriptions', { cookie }))['subscriptions'] as
    Record<string, unknown>[];
  assert.deepEqual(list.map((item) => item['id']), [REVIEW_SUBSCRIPTION_ID, sub.id]);
  const early = await call(app, 'PUT', `/v2/subscriptions/${sub.id}`, { cookie, body: { requestId: newRequestId(),
    version: sub.version, status: 'active' } });
  assert.equal(early.status, 409);
  writeSpace(app.state, { title: '样刊', ...PAGE, subscriptionId: sub.id }, 'ai');
  const current = app.state.subscriptions.require(sub.id);
  const active = json(await call(app, 'PUT', `/v2/subscriptions/${sub.id}`, { cookie, body: {
    requestId: newRequestId(), version: current.version, status: 'active' } }));
  assert.equal(active['status'], 'active');
  assert.equal(typeof active['nextRunAt'], 'string');
  assert.equal((active['issues'] as unknown[]).length, 1);
  const paused = json(await call(app, 'PUT', `/v2/subscriptions/${sub.id}`, { cookie, body: {
    requestId: newRequestId(), version: active['version'], status: 'paused' } }));
  assert.equal(paused['nextRunAt'], null);
});

test('现在出一期：开一条后台线，订阅记下这条线', async () => {
  const { app, cookie } = await start();
  const sub = research(app);
  app.respond([fauxAssistantMessage('第 1 期写好了。')]);
  const reply = await call(app, 'POST', `/v2/subscriptions/${sub.id}/run`, { cookie, body: {
    requestId: newRequestId() } });
  assert.equal(reply.status, 200);
  const lineId = String(json(reply)['lineId']);
  assert.equal(app.state.subscriptions.require(sub.id).lineId, lineId);
  assert.equal(app.state.lines.get(lineId)?.kind, 'background');
  await app.app.deps.lines.settled();
});

test('首页回顾：最近一封来信的题目（标着是来信）；研究周报那一期的结论和数字条；没有就是 null', async () => {
  const { app, cookie } = await start();
  assert.deepEqual(json(await call(app, 'GET', '/v2/review', { cookie })), { latest: null, dream: null });
  writeSpace(app.state, { title: '悬赏还缺赏金来源', subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'daily',
    genre: 'letter', html: '<p class="lt-lead">侧栏方案定稿；悬赏还缺赏金来源，卡了三天。</p><p>下一步先问赵一舟。</p>' },
  'ai');
  const latest = json(await call(app, 'GET', '/v2/review', { cookie }))['latest'] as Record<string, unknown>;
  assert.equal(latest['headline'], '悬赏还缺赏金来源');
  assert.equal(latest['edition'], 'daily');
  assert.equal(latest['genre'], 'letter');
  const sub = research(app);
  writeSpace(app.state, { title: '第 1 期', ...PAGE, subscriptionId: sub.id }, 'ai');
  const issues = json(await call(app, 'GET', `/v2/subscriptions/${sub.id}`, { cookie }))['issues'] as
    Record<string, unknown>[];
  assert.deepEqual([issues[0]?.['headline'], issues[0]?.['stats']], ['睡眠中的记忆重放', [{ value: '14', label: '篇读过' }]]);
});

test('删空间进「最近删除」、能还原；列表可只要不属于订阅的；改名走 PUT 带 version', async () => {
  const { app, cookie } = await start();
  const sub = research(app);
  const { space: own } = writeSpace(app.state, { title: '签证核查', ...PAGE }, 'ai');
  writeSpace(app.state, { title: '研究周报 · 第 1 期', ...PAGE, subscriptionId: sub.id }, 'ai');
  const standalone = json(await call(app, 'GET', '/v2/spaces?standalone=true', { cookie }))['spaces'] as
    Record<string, unknown>[];
  assert.deepEqual(standalone.map((item) => item['title']), ['签证核查']);
  const renamed = await call(app, 'PUT', `/v2/spaces/${own.id}`, { cookie, body: { requestId: newRequestId(),
    version: 1, title: '马来西亚签证核查' } });
  assert.equal(json(renamed)['title'], '马来西亚签证核查');
  assert.equal(json(renamed)['html'], HTML);
  assert.equal((await call(app, 'DELETE', `/v2/spaces/${own.id}`, { cookie, body: { requestId: newRequestId(),
    version: 1 } })).status, 409);
  const removed = await call(app, 'DELETE', `/v2/spaces/${own.id}`, { cookie, body: { requestId: newRequestId(),
    version: 2 } });
  assert.equal(removed.status, 200);
  assert.equal((await call(app, 'GET', `/v2/spaces/${own.id}`, { cookie })).status, 404);
  const trash = json(await call(app, 'GET', '/v2/library/trash', { cookie }))['items'] as Record<string, unknown>[];
  assert.deepEqual(trash.map((item) => [item['kind'], item['id'], item['title']]),
    [['space', own.id, '马来西亚签证核查']]);
  const restored = await call(app, 'POST', `/v2/spaces/${own.id}/restore`, { cookie, body: {
    requestId: newRequestId() } });
  assert.equal(restored.status, 200);
  assert.equal(json(restored)['title'], '马来西亚签证核查');
  assert.equal((await call(app, 'GET', `/v2/spaces/${own.id}`, { cookie })).status, 200);
  assert.deepEqual(json(await call(app, 'GET', '/v2/library/trash', { cookie }))['items'], []);
  assert.equal((await call(app, 'POST', '/v2/spaces/nope/restore', { cookie, body: {
    requestId: newRequestId() } })).status, 404);
});
