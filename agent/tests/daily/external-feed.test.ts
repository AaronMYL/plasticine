import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { openTestState } from '../state/helpers.ts';
import { FeedFetcher } from '../../src/daily/feed-fetch.ts';
import { parseFeed } from '../../src/daily/feed-parse.ts';
import { ExternalFeed } from '../../src/daily/external-feed.ts';
import type { FeedSelectionInput } from '../../shared/feed-selection.ts';

const AT = '2026-10-28T08:00:00.000Z';
const rss = (count = 1) => '<rss><channel>' + Array.from({ length: count }, (_, i) =>
  `<item><title>消息 ${i}</title><link>https://news.example.test/articles/${i}?token=remove&amp;page=1</link>`
  + `<pubDate>${AT}</pubDate><description><![CDATA[<p>原文 ${i}</p>]]></description></item>`).join('')
  + '</channel></rss>';

test('RSS / Atom 样本：只取最近两天，清洗链接，拒绝 DTD 和坏 XML', () => {
  assert.equal(parseFeed(rss(), 'https://news.example.test/feed', new Date(AT))[0]?.url,
    'https://news.example.test/articles/0?page=1');
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>中文</title>'
    + '<link rel="alternate" href="/story"/><updated>2026-10-27T00:00:00Z</updated>'
    + '<content type="html">&lt;p&gt;正文&lt;/p&gt;</content></entry></feed>';
  assert.equal(parseFeed(atom, 'https://news.example.test/feed', new Date(AT))[0]?.text, '正文');
  const relative = atom.replace('<entry>', '<entry xml:base="posts/">')
    .replace('<link rel="alternate" href="/story"/>', '<link rel="alternate" xml:base="../stories/" href="one"/>')
    .replace('<feed xmlns=', '<feed xml:base="/news/" xmlns=');
  assert.equal(parseFeed(relative, 'https://news.example.test/feed', new Date(AT))[0]?.url,
    'https://news.example.test/news/stories/one');
  assert.equal(parseFeed(rss(), 'https://news.example.test/feed', new Date('2026-11-01')).length, 0);
  assert.throws(() => parseFeed('<!DOCTYPE rss SYSTEM "file:///fake"><rss/>',
    'https://news.example.test/feed', new Date(AT)));
  assert.throws(() => parseFeed('<rss><channel></rss>', 'https://news.example.test/feed', new Date(AT)));
});

test('HTTP 随机端口假来源：发现订阅、每跳校验，最多三跳、2 MB 和取消', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/site') {
      res.end('<link type="application/rss+xml" rel="alternate" href="/declared">');
    } else if (req.url === '/declared') {
      res.end(rss());
    } else if (req.url === '/blog/feed.xml') {
      res.end(rss().replace('<channel>', '<channel><title>例子新闻</title>'));
    } else if (req.url === '/bad') {
      res.writeHead(302, { location: 'http://127.0.0.1/private' }).end();
    } else if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' }).end();
    } else if (req.url === '/large') {
      res.end('x'.repeat(2 * 1024 * 1024 + 1));
    } else {
      res.end('<html>没有订阅</html>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  const requests: string[] = [];
  const fetcher = new FeedFetcher({ request: async (url, signal) => {
    requests.push(url);
    return fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, { signal, redirect: 'manual' });
  } });
  try {
    const signal = AbortSignal.timeout(5_000);
    assert.deepEqual(await fetcher.discover('https://news.example.test/site', signal),
      { url: 'https://news.example.test/declared', title: null });
    // 页面没声明订阅：按目录试常见路径（feed、rss、feed.xml…），第一个像订阅源的就是；名字取订阅源的 <title>。
    assert.deepEqual(await fetcher.discover('https://news.example.test/blog/post', signal),
      { url: 'https://news.example.test/blog/feed.xml', title: '例子新闻' });
    await assert.rejects(fetcher.discover('https://news.example.test/none', signal), /这个网站没有订阅源/);
    await assert.rejects(fetcher.get('https://news.example.test/bad', signal));
    assert.ok(!requests.some((url) => url.startsWith('http:')));
    await assert.rejects(fetcher.get('https://news.example.test/loop', signal), /跳转/);
    await assert.rejects(fetcher.get('https://news.example.test/large', signal), /2 MB/);
    await assert.rejects(fetcher.get('https://news.example.test/rss', AbortSignal.abort()));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('每日七点按用户时区搜一次，档位权重轮流取、30天反应、一次脑选材、稳定去重', async () => {
  const t = await openTestState();
  let at = new Date('2026-10-28T10:59:00Z');
  const fetched: string[] = [];
  let calls = 0;
  const inputs: FeedSelectionInput[] = [];
  t.state.dailySettings.save(0, { timeZone: 'America/New_York' });
  for (const level of ['more', 'normal', 'less', 'off'] as const) {
    t.state.feedSources.ensure({ kind: 'interest', label: level, level, ref: `interest:${level}` });
  }
  const oldSource = t.state.feedSources.ensure({ kind: 'internal', label: '反应来源', ref: 'test:reaction' });
  const oldItem = t.state.feedItems.add({ title: '昨天赞过的', sourceId: oldSource.id, origin: 'feed',
    dedupeKey: 'test:liked', day: '2026-10-27', arrivedAt: '2026-10-27T10:00:00Z' }).item;
  t.state.feedItems.update(oldItem.id, oldItem.version, { reaction: 'like' });
  assert.equal(t.state.feedItems.reactionSummary('2026-10-28T00:00:00Z').length, 0);
  const desk = new ExternalFeed({ state: t.state, now: () => at,
    fetcher: new FeedFetcher({ request: async (url) => {
      fetched.push(url);
      const host = `${new URL(url).searchParams.get('q')}.example.test`;
      return new Response(rss(30).replaceAll('news.example.test', host));
    } }),
    select: async (input) => {
      calls += 1;
      inputs.push(input);
      return { items: input.candidates.slice(0, 2).map((item, index) => ({ id: item.id, sourceId: item.sourceId,
        summary: '这是两句中文摘要。包含可核验的信息。', why: '与你的关注点相关。', event: `第 ${index} 件事` })) };
    },
  });
  try {
    assert.equal(desk.scan(), 'skipped');
    at = new Date('2026-10-28T11:00:00Z');
    assert.equal(desk.scan(), 'started');
    await desk.settled();
    assert.equal(calls, 1);
    assert.equal(inputs[0]?.candidates.length, 40);
    // 每个搜索词最多十五条；少档轮到得少，四十条满时只拿到十条；关掉的不搜。
    const counts = ['more', 'normal', 'less', 'off']
      .map((label) => inputs[0]?.candidates.filter((item) => item.sourceLabel === label).length);
    assert.deepEqual(counts, [15, 15, 10, 0]);
    assert.deepEqual(inputs[0]?.reactions, [{ title: '昨天赞过的', source: '反应来源', reaction: 'like' }]);
    assert.equal(fetched.length, 3);
    assert.equal(t.state.feedItems.page({}, {}).length, 2);
    assert.equal(desk.scan(), 'skipped');
  } finally {
    await desk.stop();
    await t.cleanup();
  }
});

test('来源忽略取消或正文不再返回时仍能退出，不挂住下一轮和关机', async () => {
  for (const phase of ['headers', 'body']) {
    const controller = new AbortController();
    const fetcher = new FeedFetcher({ request: async () => phase === 'headers'
      ? new Promise<Response>(() => {}) : new Response(new ReadableStream<Uint8Array>()) });
    const timer = setTimeout(() => controller.abort(), 10);
    try { await assert.rejects(fetcher.get('https://news.example.test/hang', controller.signal)); }
    finally { clearTimeout(timer); }
  }
});

test('写入成功但通知失败，刷新回执保留已加条数与具体通知原因，不显示无错误', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  t.state.feedSources.create({ kind: 'interest', label: '测试关注点' });
  const desk = new ExternalFeed({ state: t.state, now: () => new Date(AT),
    fetcher: new FeedFetcher({ request: async () => new Response(rss()) }),
    select: async (input) => ({ items: input.candidates.map((row) => ({ id: row.id, sourceId: row.sourceId,
      summary: '消息摘要。', why: '你关注的。', event: row.id })) }),
    onAdded: () => { throw new Error('事件推送连接已关闭'); },
  });
  try {
    desk.queueRefresh('notify-failure');
    desk.resume();
    await desk.settled();
    const run = t.state.feedFetchRuns.refresh('notify-failure');
    assert.equal(run?.status, 'completed');
    assert.equal(run?.added, 1);
    assert.match(run?.error ?? '', /已保存，通知未完成.*事件推送连接已关闭/);
    assert.equal(t.state.feedItems.page({}, {}).length, 1);
  } finally { await desk.stop(); await t.cleanup(); }
});
