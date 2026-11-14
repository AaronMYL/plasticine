// 第13批（11-14 Aaron：「优先服务器抓，抓不到再改由在线的电脑重试」；pasqualepillitteri.it/zh 服务器连不上、Aaron 的
// Mac 能读）：加博客时服务器连不上，有电脑在线就先加上、排给电脑去取；电脑领活（GET /v2/nodes/feed/fetch）、交回网页
// （POST），服务器从网页里找到订阅地址换上，再让电脑取订阅、入库。没有电脑在线就照常报错，多说一句开着电脑再加。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { ComputerFetchJobsResponseSchema } from '../../shared/api/index.ts';
import { DailyError, FeedFetcher } from '../../src/daily/index.ts';
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
    code: String(json(code)['code']), name: '家里的电脑', platform: 'macos', appVersion: '0.5.0', protocolVersion: 1,
    capabilities: ['file_read'] } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return String(json(reply)['credential']);
}

const SITE = 'https://blog.example.test/zh';
const PAGE = '<html><head><title>远方的博客</title>'
  + '<link rel="alternate" type="application/rss+xml" href="/zh/feed/"></head><body></body></html>';
const FEED = '<rss><channel><title>远方的博客</title><item><title>第一篇</title>'
  + '<link>https://blog.example.test/zh/posts/1</link><pubDate>Tue, 27 Oct 2026 07:00:00 GMT</pubDate>'
  + '<description>摘要</description></item></channel></rss>';

test('加博客时服务器连不上：没电脑在线照常报错；电脑在线就先加上，电脑取回网页、找到订阅地址、再取订阅入库', async () => {
  t = await startTestApp([], { startTasks: false, feedFetcher: new FeedFetcher({ request: async () => {
    throw new DailyError('unreachable', '连不上这个网站（连接被断开），过一会儿再试。');
  } }) });
  const cookie = await pair(t);
  const path = '/v2/feed/sources/subscriptions';
  const offline = await call(t, 'POST', path, { cookie, body: { requestId: newRequestId('add'), url: SITE } });
  assert.equal(offline.status, 502);
  assert.match(JSON.stringify(offline.body), /连不上这个网站（连接被断开）。开着电脑上的 Plasticine 再加一次/);

  assert.equal((await call(t, 'GET', '/v2/nodes/feed/fetch')).status, 401);
  const headers = { authorization: `Bearer ${await pairedNode(t, cookie)}` };
  const empty = await call(t, 'GET', '/v2/nodes/feed/fetch', { headers });
  assert.ok(Value.Check(ComputerFetchJobsResponseSchema, empty.body));
  assert.deepEqual(empty.body, { jobs: [] });

  const added = await call(t, 'POST', path, { cookie, body: { requestId: newRequestId('add'), url: SITE } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const source = json(added)['source'] as { id: string; query: string; label: string };
  assert.equal(source.query, SITE);
  assert.equal(source.label, 'blog.example.test');
  const status = async (): Promise<{ error: string | null } | undefined> => {
    const others = json(await call(t!, 'GET', '/v2/feed/sources', { cookie }))['others'] as
      { id: string; label: string; query: string; status?: { error: string | null } }[];
    return others.find((row) => row.id === source.id)?.status;
  };
  assert.equal((await status())?.error, '服务器连不上这个网站（连接被断开），已让在线的电脑去取');

  const pageJob = (json(await call(t, 'GET', '/v2/nodes/feed/fetch', { headers }))['jobs'] as
    { id: string; url: string }[])[0];
  assert.equal(pageJob?.url, SITE);
  const reply = await call(t, 'POST', '/v2/nodes/feed/fetch', { headers, body: { requestId: newRequestId('ff'),
    jobId: pageJob?.id, page: { url: `${SITE}/`, text: PAGE }, error: null } });
  assert.deepEqual(reply.body, { ok: true });
  const feedJob = (json(await call(t, 'GET', '/v2/nodes/feed/fetch', { headers }))['jobs'] as
    { id: string; url: string }[])[0];
  assert.equal(feedJob?.url, 'https://blog.example.test/zh/feed/');
  await call(t, 'POST', '/v2/nodes/feed/fetch', { headers, body: { requestId: newRequestId('ff'),
    jobId: feedJob?.id, page: { url: 'https://blog.example.test/zh/feed/', text: FEED }, error: null } });
  assert.equal((await status())?.error, null);
  const items = json(await call(t, 'GET', '/v2/feed?tz=UTC&kind=rss', { cookie }))['items'] as { title: string }[];
  assert.deepEqual(items.map((item) => item.title), ['第一篇']);
  const renamed = (json(await call(t, 'GET', '/v2/feed/sources', { cookie }))['others'] as
    { id: string; label: string; query: string }[]).find((row) => row.id === source.id);
  assert.equal(renamed?.label, '远方的博客');
  assert.equal(renamed?.query, 'https://blog.example.test/zh/feed/');
  // 早交过的、认不出的：照回 ok，不再入库。
  const stale = await call(t, 'POST', '/v2/nodes/feed/fetch', { headers, body: { requestId: newRequestId('ff'),
    jobId: feedJob?.id, page: { url: 'https://blog.example.test/zh/feed/', text: FEED }, error: null } });
  assert.deepEqual(stale.body, { ok: true });
});
