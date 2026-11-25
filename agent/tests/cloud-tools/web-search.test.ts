import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSearch, WebSearchError } from '../../src/cloud-tools/index.ts';

interface Sent { url: string; auth: string | null; body: Record<string, unknown> }

function rig(reply: (sent: Sent) => { status: number; body: unknown }) {
  const store = new Map<string, unknown>();
  const sent: Sent[] = [];
  let now = new Date('2026-11-16T10:00:00.000Z');
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const one = { url: String(input), auth: headers.get('authorization'),
      body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    sent.push(one);
    const { status, body } = reply(one);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  const search = new WebSearch({ settings: { get: (key) => store.get(key), set: (key, value) => store.set(key, value) },
    fetch: fakeFetch, now: () => now });
  return { search, sent, store, later: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

const signal = new AbortController().signal;

test('missing search API key explains where to configure it without sending request', async () => {
  const { search, sent } = rig(() => ({ status: 200, body: {} }));
  assert.equal(search.status().configured, false);
  await assert.rejects(search.search('天气', { maxResults: 3, topic: 'general', timeRange: null }, signal),
    (cause: unknown) => cause instanceof WebSearchError && cause.code === 'not_configured');
  assert.equal(sent.length, 0);
});

test('web search calls Tavily with params, returns results, counts usage, masks key except last 4', async () => {
  const { search, sent, store } = rig(() => ({ status: 200, body: { results: [
    { title: '示例新闻', url: 'https://example.com/a', content: '一段摘要', published_date: '2026-11-15' },
    { url: 'https://example.com/b' }, { title: '没有链接' }] } }));
  search.save('tvly-example-key-0001');
  const results = await search.search('示例', { maxResults: 3, topic: 'news', timeRange: 'week' }, signal);
  assert.deepEqual(results, [
    { title: '示例新闻', url: 'https://example.com/a', snippet: '一段摘要', publishedAt: '2026-11-15' },
    { title: 'https://example.com/b', url: 'https://example.com/b', snippet: '', publishedAt: null }]);
  assert.equal(sent[0]?.url, 'https://api.tavily.com/search');
  assert.equal(sent[0]?.auth, 'Bearer tvly-example-key-0001');
  assert.deepEqual(sent[0]?.body, { query: '示例', search_depth: 'basic', topic: 'news', max_results: 3,
    include_published_date: true, time_range: 'week' });
  const status = search.status();
  assert.equal(status.keyHint, '…0001');
  assert.equal(status.usedThisMonth, 1);
  assert.ok(!JSON.stringify(status).includes('tvly-example-key-0001'));
  assert.ok(store.has('web_search'));
});

test('invalid key and exhausted quota give clear messages; failed calls do not count toward usage', async () => {
  const codes = [401, 432];
  const { search } = rig(() => ({ status: codes.shift() ?? 500, body: { detail: 'no' } }));
  search.save('tvly-example-key-0002');
  await assert.rejects(search.search('a', { maxResults: 1, topic: 'general', timeRange: null }, signal),
    /密钥不对/);
  await assert.rejects(search.search('a', { maxResults: 1, topic: 'general', timeRange: null }, signal),
    /额度用完/);
  assert.equal(search.status().usedThisMonth, 0);
});

test('web fetch returns Markdown, truncates long pages, explains failure and points to browser', async () => {
  const bodies: unknown[] = [
    { results: [{ url: 'https://example.com/a', raw_content: '# 标题\n正文' }], failed_results: [] },
    { results: [], failed_results: [{ url: 'https://example.com/b', error: 'blocked' }] },
    { results: [{ url: 'https://example.com/c', raw_content: '字'.repeat(70_000) }] },
  ];
  const { search, sent } = rig(() => ({ status: 200, body: bodies.shift() }));
  search.save('tvly-example-key-0003');
  assert.deepEqual(await search.extract('https://example.com/a', signal),
    { url: 'https://example.com/a', content: '# 标题\n正文', truncated: false });
  assert.deepEqual(sent[0]?.body, { urls: ['https://example.com/a'], extract_depth: 'basic', format: 'markdown' });
  await assert.rejects(search.extract('https://example.com/b', signal), /blocked.*浏览器/s);
  const long = await search.extract('https://example.com/c', signal);
  assert.equal(long.truncated, true);
  assert.equal(long.content.length, 60_000);
});

test('search test records timestamp and status; monthly usage counter resets on new month', async () => {
  const { search, later } = rig(() => ({ status: 200, body: { results: [] } }));
  assert.deepEqual(await search.test(signal), { ok: false, error: '还没填密钥。' });
  search.save('tvly-example-key-0004');
  assert.deepEqual(await search.test(signal), { ok: true, error: null });
  assert.equal(search.status().testOk, true);
  assert.equal(search.status().usedThisMonth, 1);
  later(20 * 24 * 60 * 60 * 1000);
  assert.equal(search.status().usedThisMonth, 0);
  search.save(null);
  assert.equal(search.status().configured, false);
});
