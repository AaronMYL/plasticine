// /v2/spaces、/v2/subscriptions、/v2/review（《优化清单》第 6、7 条）：401 / 400 / 404 / 409 / 200，
// 他直接改、撤销、「以后都这样」、开定时要先有样刊、现在出一期、首页回顾。

import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { SpaceDoc } from '../../shared/state.ts';
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

const DOC: SpaceDoc = { headline: '睡眠中的记忆重放', stats: [{ value: '14', label: '篇读过' }],
  blocks: [{ type: 'heading', id: 'overview', text: '本周概览' }, { type: 'text', markdown: '重放越多越好。' }],
  sources: [] };

function research(app: TestApp) {
  return app.state.subscriptions.create({ title: '认知与神经科学研究周报', kind: 'research', status: 'draft',
    timeZone: 'Asia/Shanghai', settings: researchDraft({ topics: ['睡眠'] }) });
}

test('没登录 401；读不存在的空间 404；列表里有空间和它的来路', async () => {
  const { app, cookie } = await start();
  assert.equal((await call(app, 'GET', '/v2/spaces')).status, 401);
  assert.equal((await call(app, 'GET', '/v2/spaces/nope', { cookie })).status, 404);
  const sub = research(app);
  writeSpace(app.state, { title: '马来西亚签证核查', doc: DOC }, 'ai');
  writeSpace(app.state, { title: '研究周报 · 第 1 期', doc: DOC, subscriptionId: sub.id }, 'ai');
  const list = json(await call(app, 'GET', '/v2/spaces', { cookie }))['spaces'] as Record<string, unknown>[];
  assert.deepEqual(list.map((item) => [item['title'], item['kind'], item['issueNumber']]),
    [['研究周报 · 第 1 期', 'research', 1], ['马来西亚签证核查', 'space', null]]);
});

test('他直接改：存成新的一版、作者记他；版本过时 409；正文不合规 400', async () => {
  const { app, cookie } = await start();
  const space = writeSpace(app.state, { title: '草稿', doc: DOC }, 'ai');
  const saved = await call(app, 'PUT', `/v2/spaces/${space.id}`, { cookie, body: { requestId: newRequestId(),
    version: 1, doc: { ...DOC, headline: '我改的结论' } } });
  assert.equal(saved.status, 200);
  assert.equal(json(saved)['version'], 2);
  assert.equal(json(saved)['author'], 'user');
  assert.equal((await call(app, 'PUT', `/v2/spaces/${space.id}`, { cookie, body: { requestId: newRequestId(),
    version: 1, doc: DOC } })).status, 409);
  const bad = await call(app, 'PUT', `/v2/spaces/${space.id}`, { cookie, body: { requestId: newRequestId(),
    version: 2, doc: { ...DOC, blocks: [{ type: 'text', markdown: '没出处[^2]' }] } } });
  assert.equal(bad.status, 400);
});

test('Plasticine 改了一期：页底有「改了什么」和规则；「以后都这样」写进订阅设置，「撤销」恢复上一版', async () => {
  const { app, cookie } = await start();
  const sub = research(app);
  const issue = writeSpace(app.state, { title: '第 2 期', doc: DOC, subscriptionId: sub.id }, 'ai');
  writeSpace(app.state, { id: issue.id, version: 1, title: '第 2 期', doc: { ...DOC, headline: '改过' },
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
  assert.equal((json(undone)['doc'] as SpaceDoc).headline, '睡眠中的记忆重放');
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
  writeSpace(app.state, { title: '样刊', doc: DOC, subscriptionId: sub.id }, 'ai');
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

test('首页回顾：最近一期个人回顾的一句；没有就是 null', async () => {
  const { app, cookie } = await start();
  assert.deepEqual(json(await call(app, 'GET', '/v2/review', { cookie })), { latest: null, dream: null });
  writeSpace(app.state, { title: '日报 · 11月7日', subscriptionId: REVIEW_SUBSCRIPTION_ID, edition: 'daily',
    doc: { ...DOC, headline: '侧栏方案定稿；悬赏还缺赏金来源，卡了三天' } }, 'ai');
  const latest = json(await call(app, 'GET', '/v2/review', { cookie }))['latest'] as Record<string, unknown>;
  assert.equal(latest['headline'], '侧栏方案定稿；悬赏还缺赏金来源，卡了三天');
  assert.equal(latest['edition'], 'daily');
});

test('删空间进「最近删除」、能还原；列表可只要不属于订阅的；改名走 PUT 带 version', async () => {
  const { app, cookie } = await start();
  const sub = research(app);
  const own = writeSpace(app.state, { title: '签证核查', doc: DOC }, 'ai');
  writeSpace(app.state, { title: '研究周报 · 第 1 期', doc: DOC, subscriptionId: sub.id }, 'ai');
  const standalone = json(await call(app, 'GET', '/v2/spaces?standalone=true', { cookie }))['spaces'] as
    Record<string, unknown>[];
  assert.deepEqual(standalone.map((item) => item['title']), ['签证核查']);
  const renamed = await call(app, 'PUT', `/v2/spaces/${own.id}`, { cookie, body: { requestId: newRequestId(),
    version: 1, title: '马来西亚签证核查', doc: DOC } });
  assert.equal(json(renamed)['title'], '马来西亚签证核查');
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
