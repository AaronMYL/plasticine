import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { FeedFetcher } from '../../src/daily/feed-fetch.ts';
import { searchNews } from '../../src/daily/search-feed.ts';
import { parseNewsRss, parseSearchRss } from '../../src/daily/search-parse.ts';
import { searchTerms } from '../../shared/feed-search.ts';

const AT = '2026-10-29T08:00:00.000Z';
const ARTICLE = 'https://news.example.test/articles/one?page=2';
const wrap = (items: string) => `<rss xmlns:News="urn:news"><channel>${items}</channel></rss>`;
const item = (link: string, date = AT) => '<item><title><![CDATA[新的 <b>消息</b>]]></title>'
  + `<link>${link.replaceAll('&', '&amp;')}</link><description>摘要 &amp; 正文</description>`
  + `<pubDate>${date}</pubDate><News:Source>来源站</News:Source></item>`;

test('搜索词：未改过的迁移关注点按分隔符拆两项，自己加或改过的查询原样用', () => {
  for (const separator of ['与', '和', '及', '、', ',', '，', '/', '&', '+']) {
    assert.deepEqual(searchTerms({ label: `投资${separator}期权${separator}宏观`, query: '很长的说明', custom: false }),
      ['投资', '期权']);
  }
  assert.deepEqual(searchTerms({ label: '人工智能与教育', query: 'AI & education', custom: true }), ['AI & education']);
  assert.deepEqual(searchTerms({ label: 'A', query: null, custom: false }), ['A']);
});

test('新闻和网页 RSS：还原 Bing 链接、清洗网址、保留来源与时间，网页标无日期', () => {
  const link = `https://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(`${ARTICLE}&token=remove#part`)}`;
  const news = parseNewsRss(wrap(item(link)));
  assert.deepEqual(news, [{ title: '新的 消息', url: ARTICLE, text: '摘要 & 正文',
    publishedAt: AT, site: '来源站', undated: false }]);
  assert.equal(parseSearchRss(wrap(item(ARTICLE)))[0]?.publishedAt, null);
  assert.equal(parseSearchRss(wrap(item(ARTICLE)))[0]?.undated, true);
  assert.equal(parseNewsRss(wrap(item('https://notbing.com/path?url=https%3A%2F%2Fexample.test')))[0]?.url,
    'https://notbing.com/path');
  assert.throws(() => parseNewsRss('<html>不是 RSS</html>'));
  assert.throws(() => parseNewsRss('<!DOCTYPE rss><rss/>'));
});

test('本地假 HTTP：新闻空或失败退网页，语言参数、跳转、超大响应和超时都受抓取器约束', async () => {
  const seen: URL[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const term = url.searchParams.get('q');
    if (term === 'timeout') { return; }
    if (term === 'large') { res.end('x'.repeat(2 * 1024 * 1024 + 1)); return; }
    if (term === 'private') { res.writeHead(302, { location: 'http://127.0.0.1/private' }).end(); return; }
    if (term === 'loop') { res.writeHead(302, { location: req.url }).end(); return; }
    if (term === 'redirect' && url.pathname === '/news/search') {
      res.writeHead(302, { location: '/final' }).end();
      return;
    }
    if (term === 'empty' && url.pathname === '/news/search') { res.end(wrap('')); return; }
    if (term === 'failed' && url.pathname === '/news/search') { res.writeHead(500).end(); return; }
    const link = `https://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(ARTICLE)}`;
    res.end(wrap(item(link)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const fetcher = new FeedFetcher({ request: async (raw, signal) => {
    const url = new URL(raw);
    seen.push(url);
    return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, { signal, redirect: 'manual' });
  } });
  try {
    assert.equal((await searchNews('中文', fetcher, AbortSignal.timeout(5_000)))[0]?.url, ARTICLE);
    assert.equal(seen[0]?.searchParams.get('setlang'), 'zh-hans');
    assert.equal(seen[0]?.searchParams.get('qft'), 'interval="7"');
    assert.equal(seen[0]?.searchParams.has('cc'), false);
    for (const term of ['empty', 'failed']) {
      assert.equal((await searchNews(term, fetcher, AbortSignal.timeout(5_000)))[0]?.undated, true);
    }
    assert.equal(seen[1]?.searchParams.get('cc'), 'US');
    assert.ok(seen.some((url) => url.pathname === '/search' && url.searchParams.get('format') === 'rss'));
    assert.equal((await searchNews('redirect', fetcher, AbortSignal.timeout(5_000)))[0]?.url, ARTICLE);
    for (const term of ['large', 'private', 'loop']) {
      await assert.rejects(searchNews(term, fetcher, AbortSignal.timeout(5_000)));
    }
    await assert.rejects(searchNews('timeout', fetcher, AbortSignal.timeout(30)));
    assert.ok(seen.every((url) => url.protocol === 'https:' && url.hostname === 'www.bing.com'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
