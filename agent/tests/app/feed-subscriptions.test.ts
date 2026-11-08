import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedFetcher } from '../../src/daily/index.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

test('加网站发现 RSS，来源可见可调档；回执重放不用再访问网站，改请求体被拒', async () => {
  let reads = 0;
  const t = await startTestApp([], { feedFetcher: new FeedFetcher({ request: async () => {
    reads += 1;
    return new Response('<link rel="alternate" type="application/atom+xml" href="/atom?token=remove">');
  } }) });
  try {
    const path = '/v2/feed/sources/subscriptions';
    const body = { requestId: 'test-subscription-one', label: '例子', url: 'https://news.example.test/' };
    assert.equal((await call(t, 'POST', path, { body })).status, 401);
    assert.equal(reads, 0);
    const cookie = await pair(t);
    const first = await call(t, 'POST', path, { cookie, body });
    assert.equal(first.status, 201);
    // 加上就抓一次（第 3 批：不等下一个两小时）：等它抓完再数。
    await t.app.deps.daily.subscriptions.settled();
    assert.equal(reads, 2);
    assert.deepEqual((await call(t, 'POST', path, { cookie, body })).body, first.body);
    assert.equal(reads, 2);
    assert.equal((await call(t, 'POST', path, { cookie, body: { ...body, label: '另一个名字' } })).status, 409);
    const source = json(first)['source'] as { id: string; kind: string; query: string; version: number };
    assert.equal(source.kind, 'rss');
    assert.equal(source.query, 'https://news.example.test/atom');
    const list = json(await call(t, 'GET', '/v2/feed/sources', { cookie }))['others'] as { id: string }[];
    assert.ok(list.some((row) => row.id === source.id));
    assert.equal((await call(t, 'POST', `/v2/feed/sources/${source.id}/level`, { cookie,
      body: { requestId: 'test-subscription-off', version: source.version, level: 'off' } })).status, 200);
  } finally { await t.close(); }
});

test('发现不到订阅源给明确信息，HTTP 地址不能进抓取器', async () => {
  let reads = 0;
  const t = await startTestApp([], { feedFetcher: new FeedFetcher({ request: async () => {
    reads += 1;
    return new Response('<html>没有订阅</html>');
  } }) });
  try {
    const cookie = await pair(t);
    const body = { requestId: 'test-no-subscription', label: '例子', url: 'https://news.example.test/' };
    const reply = await call(t, 'POST', '/v2/feed/sources/subscriptions', { cookie, body });
    assert.equal(reply.status, 400);
    assert.ok(JSON.stringify(reply.body).includes('这个网站没有订阅源'));
    assert.equal((await call(t, 'POST', '/v2/feed/sources/subscriptions',
      { cookie, body: { ...body, url: 'http://127.0.0.1/private' } })).status, 400);
    // 页面本身 + 六个常见路径（第 3 批：自己找订阅地址；页面在站点根目录，两组路径重合），都不是订阅源。
    assert.equal(reads, 7);
  } finally { await t.close(); }
});
