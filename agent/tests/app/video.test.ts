// 第 6 批：信息流第二栏（GET /v2/feed/nav）、抖音收藏的勾选清单（/v2/video/douyin）和 Mac 那一头（/v2/nodes/douyin）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import {
  DouyinJobsResponseSchema,
  DouyinListResponseSchema,
  FeedNavResponseSchema,
} from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, registerKey, signedCall } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function pairedNode(app: TestApp, cookie: string): Promise<string> {
  const key = newDeviceKey();
  assert.equal((await registerKey(app, cookie, key)).status, 201);
  const code = await signedCall(app, 'POST', '/v2/nodes/pairing-codes', { requestId: newRequestId('code') },
    { cookie, key });
  const reply = await call(app, 'POST', '/v2/nodes/pair', { body: { requestId: newRequestId('pair'),
    code: String(json(code)['code']), name: '家里的 Mac', platform: 'macos', appVersion: '0.8.0', protocolVersion: 1,
    capabilities: ['file_read'] } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return String(json(reply)['credential']);
}

test('第二栏：全部 + 每个来源一行（内置的 X、抖音收藏、按关注点的新闻），带今天新来的个数', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const added = await call(t, 'POST', '/v2/feed/items', { cookie,
    body: { requestId: 'manual-item-01', title: '手动加的一条' } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const nav = await call(t, 'GET', '/v2/feed/nav?tz=Asia/Shanghai', { cookie });
  assert.equal(nav.status, 200);
  assert.ok(Value.Check(FeedNavResponseSchema, nav.body));
  const body = json(nav);
  assert.equal(body['all'], 1);
  const sources = body['sources'] as { kind: string; label: string; count: number; problem: string | null }[];
  assert.deepEqual(sources.map((source) => source.kind), ['x', 'douyin', 'news']);
  assert.deepEqual(sources.map((source) => source.label), ['X 关注', '抖音收藏', '按关注点的新闻']);
  assert.ok(sources.every((source) => source.count === 0 && source.problem === null));
  // 抖音同步排着、电脑不在线：那一行写出来。
  await call(t, 'POST', '/v2/video/douyin/sync', { cookie, body: { requestId: 'douyin-sync-nav' } });
  const again = json(await call(t, 'GET', '/v2/feed/nav?tz=Asia/Shanghai', { cookie }));
  const douyin = (again['sources'] as { kind: string; problem: string | null }[])
    .find((source) => source.kind === 'douyin');
  assert.equal(douyin?.problem, '等电脑上线再同步');
});

test('抖音收藏：同步排给 Mac；Mac 凭节点凭证取活、交回标题；勾选处理排上；重复请求幂等', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/nodes/douyin')).status, 401);
  const sync = await call(t, 'POST', '/v2/video/douyin/sync',
    { cookie, body: { requestId: 'douyin-sync-01', full: true } });
  assert.equal(sync.status, 202, JSON.stringify(sync.body));
  assert.equal((json(sync)['sync'] as { state: string }).state, 'waiting_mac');
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  const jobs = await call(t, 'GET', '/v2/nodes/douyin', { headers });
  assert.ok(Value.Check(DouyinJobsResponseSchema, jobs.body));
  const [job] = json(jobs)['jobs'] as { id: string; kind: string; full?: boolean }[];
  assert.equal(job?.kind, 'list');
  assert.equal(job?.full, true);
  const work = { workId: '7300000000000000001', title: '普通人做指数定投的三个误区', caption: '', author: '理财小课堂',
    kind: 'video', durationSeconds: 222, publishedAt: null, listPosition: 0,
    collectedAt: '2026-11-06T08:00:00.000Z', folderIds: [] };
  assert.equal((await call(t, 'POST', '/v2/nodes/douyin', { headers, body: { requestId: 'douyin-list-01',
    jobId: job!.id, list: { folders: [], works: [{ ...work, workId: '../1' }], done: true } } })).status, 400);
  const report = await call(t, 'POST', '/v2/nodes/douyin', { headers, body: { requestId: 'douyin-list-01',
    jobId: job!.id, list: { folders: [], works: [work], done: true } } });
  assert.deepEqual(report.body, { accepted: true, added: 1 });
  const list = await call(t, 'GET', '/v2/video/douyin?q=定投', { cookie });
  assert.ok(Value.Check(DouyinListResponseSchema, list.body), JSON.stringify(list.body));
  const body = json(list);
  assert.equal(body['total'], 1);
  assert.equal(body['macOnline'], true);
  const [row] = body['works'] as { id: string; stage: string }[];
  assert.equal(row?.stage, 'synced');
  assert.equal((await call(t, 'POST', '/v2/video/douyin/process', { cookie,
    body: { requestId: 'douyin-proc-00', ids: [] } })).status, 400);
  const first = await call(t, 'POST', '/v2/video/douyin/process', { cookie,
    body: { requestId: 'douyin-proc-01', ids: [row!.id] } });
  assert.equal(first.status, 202);
  assert.equal(json(first)['queued'], 1);
  const again = await call(t, 'POST', '/v2/video/douyin/process', { cookie,
    body: { requestId: 'douyin-proc-01', ids: [row!.id] } });
  assert.equal(json(again)['queued'], 1, '同一个 requestId 回原来的回执');
});
