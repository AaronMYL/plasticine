import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedFetcher } from '../../src/daily/index.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

test('现在刷新：认证、输入、同请求并发重放、同日追加及重启后回执均幂等', async () => {
  let reads = 0;
  let next = 0;
  const fetcher = new FeedFetcher({ request: async () => {
    reads += 1;
    return new Response('<rss><channel>' + Array.from({ length: next + 1 }, (_, i) =>
      `<item><title>消息${i}</title><link>https://example.test/articles/${i}</link>`
      + '<pubDate>2026-10-27T07:00:00Z</pubDate></item>').join('') + '</channel></rss>');
  } });
  const t = await startTestApp([async (request) => {
    const message = request.messages.find((row) => row.role === 'user');
    assert.ok(message !== undefined);
    const input = JSON.parse(message.content) as { candidates: { id: string }[]; interests: { id: string }[] };
    return { text: JSON.stringify({ items: input.candidates.map((row) => ({ id: row.id,
      sourceId: input.interests[0]!.id, summary: '已核对主题。', why: '与技术有关。', event: row.id })) }),
    complete: true };
  }], { feedFetcher: fetcher, startTasks: false });
  let restarted: Awaited<ReturnType<typeof startTestApp>> | undefined;
  try {
    t.state.feedSources.create({ kind: 'interest', label: '技术' });
    const path = '/v2/feed/refresh';
    const body = { requestId: 'test-refresh-one' };
    assert.equal((await call(t, 'POST', path, { body })).status, 401);
    assert.equal((await call(t, 'GET', `${path}/${body.requestId}`)).status, 401);
    const cookie = await pair(t);
    assert.equal((await call(t, 'GET', `${path}/missing`, { cookie })).status, 404);
    assert.equal((await call(t, 'POST', path, { cookie, body: {} })).status, 400);
    const replies = await Promise.all([call(t, 'POST', path, { cookie, body }),
      call(t, 'POST', path, { cookie, body })]);
    assert.ok(replies.every((reply) => reply.status === 202));
    assert.deepEqual(replies[0]?.body, replies[1]?.body);
    await t.app.deps.daily.externalFeed?.settled();
    assert.equal(reads, 1);
    assert.equal(t.state.feedItems.page({}, {}).length, 1);
    const result = json(await call(t, 'GET', `${path}/${body.requestId}`, { cookie }));
    assert.equal(result['status'], 'completed');
    assert.equal(result['added'], 1);
    next = 1;
    await call(t, 'POST', path, { cookie, body: { requestId: 'test-refresh-two' } });
    await t.app.deps.daily.externalFeed?.settled();
    assert.equal(t.state.feedItems.page({}, {}).length, 2);
    assert.equal(reads, 2);
    await t.close(true);
    restarted = await startTestApp([], { feedFetcher: fetcher, startTasks: false, directory: t.directory });
    const again = await call(restarted, 'POST', path, { cookie, body });
    assert.equal(again.status, 202);
    assert.equal(reads, 2);
    restarted.clock.advance(2 * 24 * 60 * 60 * 1_000);
    assert.equal((await call(restarted, 'POST', path, { cookie, body })).status, 202);
    await restarted.app.deps.daily.externalFeed?.settled();
    assert.equal(reads, 2);
  } finally {
    if (restarted !== undefined) { await restarted.close(); }
    else { await t.close(); }
  }
});

test('未配置抓取器时刷新给下一步；不要的词用共享每日设置保存', async () => {
  const t = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(t);
    assert.equal((await call(t, 'POST', '/v2/feed/refresh', { cookie,
      body: { requestId: 'test-no-fetcher' } })).status, 503);
    const saved = await call(t, 'PUT', '/v2/today/settings', { cookie,
      body: { requestId: 'test-banned-terms', version: 0, feedBannedTerms: ['广告', '标题党'] } });
    assert.equal(saved.status, 200);
    assert.deepEqual(t.state.dailySettings.read().settings.feedBannedTerms, ['广告', '标题党']);
    assert.deepEqual(json(await call(t, 'GET', '/v2/today/settings', { cookie }))['feedBannedTerms'], ['广告', '标题党']);
  } finally { await t.close(); }
});

test('查询词可编辑：带版本和请求标识，重放不重写，冲突给当前来源', async () => {
  const t = await startTestApp([], { startTasks: false });
  try {
    const source = t.state.feedSources.create({ kind: 'interest', label: '技术与教育', query: '旧说明' },
      { migratedDefault: true });
    const path = `/v2/feed/sources/${source.id}/query`;
    const body = { requestId: 'test-query-one', version: source.version, query: 'AI & learning' };
    assert.equal((await call(t, 'POST', path, { body })).status, 401);
    const cookie = await pair(t);
    assert.equal((await call(t, 'POST', path, { cookie, body: { ...body, query: ' ' } })).status, 400);
    const first = await call(t, 'POST', path, { cookie, body });
    assert.equal(first.status, 200);
    assert.deepEqual(json(first)['source'], json(await call(t, 'POST', path, { cookie, body }))['source']);
    assert.equal((await call(t, 'POST', path, { cookie, body: { ...body, query: '不同' } })).status, 409);
    assert.equal((await call(t, 'POST', path, { cookie,
      body: { ...body, requestId: 'test-query-stale' } })).status, 409);
    const fresh = t.state.feedSources.require(source.id);
    assert.equal(fresh.queryEdited, true);
    const view = json(first)['source'] as { searchTerms: string[] };
    assert.deepEqual(view.searchTerms, ['AI & learning']);
  } finally { await t.close(); }
});
