// 第 6 批：信息流第二栏（GET /v2/feed/nav）、抖音收藏的勾选清单（/v2/video/douyin）和 Mac 那一头（/v2/nodes/douyin）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import {
  DouyinJobsResponseSchema,
  DouyinListResponseSchema,
  FeedNavResponseSchema,
  TranscriberResponseSchema,
} from '../../shared/api/index.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';
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

test('第二栏：全部 + 每个来源一行（内置的兴趣、X、小红书、抖音收藏），带今天新来的个数', async () => {
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
  assert.deepEqual(sources.map((source) => source.kind), ['news', 'x', 'xhs', 'douyin']);
  assert.deepEqual(sources.map((source) => source.label), ['兴趣', 'X', '小红书', '抖音收藏']);
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

test('收藏关联同一份空间，资料库修改后读最新版本，不重做视频解析', async () => {
  const { publishVideoSpace } = await import('../../src/video/space-report.ts');
  const { writeSpace } = await import('../../src/subs/index.ts');
  t = await startTestApp();
  const cookie = await pair(t);
  const work = t.state.videoWorks.upsert({ platform: 'douyin', workId: '7300000000000000010',
    url: 'https://www.douyin.com/video/7300000000000000010', title: '示例收藏' }).work;
  const done = t.state.videoWorks.advance(work.id, { stage: 'summarized', transcript: '原逐字稿',
    digest: { summary: '给协作保留一份可以继续使用的记录。', outline: [], points: [], related: [] } });
  const space = publishVideoSpace(t.state, done)!;
  const list = json(await call(t, 'GET', '/v2/video/douyin', { cookie }))['works'] as Record<string, unknown>[];
  assert.equal(list[0]?.['spaceId'], space.id);
  const edited = writeSpace(t.state, { id: space.id, version: space.version, title: '最新的收藏总结',
    html: '<h1>这是一份从资料库改好的最新收藏总结。</h1>' }, 'user').space;
  const view = json(await call(t, 'GET', `/v2/spaces/${space.id}`, { cookie }));
  assert.equal(view['version'], edited.version);
  assert.equal(view['html'], edited.html);
  assert.equal(t.state.videoWorks.require(work.id).transcript, '原逐字稿');
});

test('抖音收藏的三个数按全部收藏算，「没整理 / 已整理」在服务端筛，不只算读出来的那一页', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const ids = Array.from({ length: 5 }, (_, index) => t!.state.videoWorks.upsert({ platform: 'douyin',
    workId: `73000000000000001${index}`, url: `https://www.douyin.com/video/73000000000000001${index}`,
    title: `示例收藏 ${index}`, collectSeq: 100 - index }).work.id);
  t.state.videoWorks.advance(ids[4]!, { stage: 'summarized', transcript: '逐字稿',
    digest: { summary: '最早收藏的那一条整理好了。', outline: [], points: [], related: [] } });
  const first = json(await call(t, 'GET', '/v2/video/douyin?limit=2', { cookie }));
  assert.ok(Value.Check(DouyinListResponseSchema, first), JSON.stringify(first));
  assert.deepEqual(first['counts'], { all: 5, todo: 4, done: 1 });
  assert.equal((first['works'] as unknown[]).length, 2);
  const done = json(await call(t, 'GET', '/v2/video/douyin?phase=done&limit=2', { cookie }));
  assert.deepEqual((done['works'] as { title: string }[]).map((work) => work.title), ['示例收藏 4']);
  assert.equal(done['total'], 1);
  assert.equal(done['nextOffset'], null);
  assert.deepEqual(done['counts'], { all: 5, todo: 4, done: 1 }, '三个数不跟着筛选变');
  const todo = json(await call(t, 'GET', '/v2/video/douyin?phase=todo&limit=3&offset=3', { cookie }));
  assert.deepEqual((todo['works'] as { title: string }[]).map((work) => work.title), ['示例收藏 3']);
  assert.equal(todo['total'], 4);
  const searched = json(await call(t, 'GET', '/v2/video/douyin?q=4', { cookie }));
  assert.deepEqual(searched['counts'], { all: 1, todo: 0, done: 1 }, '搜索时三个数按搜到的算');
  assert.equal((await call(t, 'GET', '/v2/video/douyin?phase=running', { cookie })).status, 400);
});

test('本地转写：没装时视频停在「等转写装好」不下载；点安装后台装、推进度，装好接着走', async () => {
  const { createHash } = await import('node:crypto');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const content = Buffer.from('假的组件');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const plan = { files: [{ name: 'kit.tar.bz2', url: 'https://example.test/kit.tar.bz2', bytes: content.length,
    sha256, into: 'sherpa', unpack: { kind: 'tar.bz2' as const, members: ['rt/bin/asr'] } }],
  binary: 'sherpa/rt/bin/asr', model: 'model/m.onnx', tokens: 'model/t.txt', vad: 'model/v.onnx', ffmpeg: 'ffmpeg/f' };
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  t = await startTestApp([], { transcriberKit: { plan, ports: {
    async download(_url, file, _signal, bytes) {
      await held;
      await writeFile(file, content);
      bytes(content.length);
    },
    async untar(_archive, into, members) {
      for (const member of members) {
        await mkdir(join(into, member, '..'), { recursive: true });
        await writeFile(join(into, member), '程序');
      }
    },
    async check() {},
  } } });
  const cookie = await pair(t);
  const work = t.state.videoWorks.upsert({ platform: 'douyin', workId: '7300000000000000020',
    url: 'https://www.douyin.com/video/7300000000000000020', title: '一条视频收藏', kind: 'video' }).work;
  const before = json(await call(t, 'GET', '/v2/video/transcriber', { cookie }));
  assert.ok(Value.Check(TranscriberResponseSchema, before), JSON.stringify(before));
  assert.deepEqual((before['status'] as { state: string; totalBytes: number }),
    { state: 'absent', source: null, totalBytes: content.length, doneBytes: 0, step: null, error: null });
  await call(t, 'POST', '/v2/video/douyin/process', { cookie, body: { requestId: 'douyin-proc-kit', ids: [work.id] } });
  await t.app.deps.video.worker.settled();
  const waiting = json(await call(t, 'GET', '/v2/video/douyin', { cookie }))['works'] as { run: string }[];
  assert.equal(waiting[0]?.run, 'waiting_transcriber');
  const events = await openEvents(t, cookie);
  const install = await call(t, 'POST', '/v2/video/transcriber/install', { cookie,
    body: { requestId: 'transcriber-install-01' } });
  assert.equal(install.status, 202, JSON.stringify(install.body));
  assert.equal((json(install)['status'] as { state: string }).state, 'installing');
  const progress = await events.next('transcriber_changed');
  assert.equal((progress.event as { status: { state: string } }).status.state, 'installing');
  release();
  await t.app.deps.video.kit.settled();
  for (;;) {
    const frame = await events.next('transcriber_changed');
    if ((frame.event as { status: { state: string } }).status.state === 'ready') break;
  }
  events.close();
  await t.app.deps.video.worker.settled();
  assert.equal(t.state.videoWorks.require(work.id).run, 'waiting_mac', '装好以后接着走：先让电脑取地址');
  const after = json(await call(t, 'GET', '/v2/video/transcriber', { cookie }))['status'] as { state: string };
  assert.deepEqual([after.state, (after as { source?: string }).source], ['ready', 'kit']);
});
