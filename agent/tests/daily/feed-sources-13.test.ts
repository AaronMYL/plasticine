// 第13批阅读（11-14 Aaron：「加了 Reddit 来源后页面为空；网页上加的两个博客，一个加不上，一个只有一篇、内容被截断」）：
// Reddit 限流只停那一个版块、写清几分钟后再取，加版块时把预览取到的存进来；博客抓不到说真实原因，第一次导入最近 10 篇
// （不只两天内的），存全文（段落和图），来源名用网站名不用订阅链接上写的「Recent Entries」。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleBlocks } from '../../src/daily/article-blocks.ts';
import { DailyError } from '../../src/daily/errors.ts';
import { FeedFetcher } from '../../src/daily/feed-fetch.ts';
import { FeedSubscriptions } from '../../src/daily/feed-subscriptions.ts';
import { openTestState } from '../state/helpers.ts';

const AT = '2026-11-14T08:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

function rssItem(index: number, daysAgo: number, html = `<p>正文 ${index}</p>`): string {
  return `<item><title>文章 ${index}</title><link>https://blog.example.test/posts/${index}</link>`
    + `<pubDate>${new Date(Date.parse(AT) - daysAgo * DAY).toUTCString()}</pubDate>`
    + `<description><![CDATA[摘要 ${index}]]></description>`
    + `<content:encoded><![CDATA[${html}]]></content:encoded></item>`;
}
const rss = (items: string) => '<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>'
  + `<title>慢工博客</title>${items}</channel></rss>`;

function redditFeed(subreddit: string, count: number): string {
  const entries = Array.from({ length: count }, (_, index) => `<entry><title>${subreddit} 帖子 ${index}</title>`
    + `<link href="https://www.reddit.com/r/${subreddit}/comments/${index}/p/"/>`
    + `<updated>${new Date(Date.parse(AT) - (index + 1) * 60_000).toISOString()}</updated>`
    + '<content type="html">&lt;p&gt;内容&lt;/p&gt;</content></entry>').join('');
  return `<feed xmlns="http://www.w3.org/2005/Atom"><title>r/${subreddit}</title>${entries}</feed>`;
}

test('全文读成一段段：段落、小标题、引用、列表、代码、图；脚本不要，图只要 https', () => {
  const blocks = articleBlocks('<h2>第一节</h2><p>第一段 <a href="https://x.test">链接字</a>。</p>'
    + '<div><p>里面的段落</p></div><blockquote><p>一句引用</p></blockquote><ul><li>一</li><li>二</li></ul>'
    + '<pre>const a = 1;\n  return a;</pre><img src="/img/a.png" alt="图一"><img src="http://plain.test/b.png">'
    + '<script>alert(1)</script><p>最后一段<br>换行</p>', 'https://blog.example.test/posts/1');
  assert.deepEqual(blocks, [
    { t: 'h', text: '第一节' },
    { t: 'p', text: '第一段 链接字。' },
    { t: 'p', text: '里面的段落' },
    { t: 'quote', text: '一句引用' },
    { t: 'li', text: '一' },
    { t: 'li', text: '二' },
    { t: 'code', text: 'const a = 1;\n  return a;' },
    { t: 'img', text: '图一', src: 'https://blog.example.test/img/a.png' },
    { t: 'p', text: '最后一段 换行' },
  ]);
});

test('博客第一次抓导入最近 10 篇（不只两天内的），存全文；之后只收新的', async () => {
  const t = await openTestState();
  const source = t.state.feedSources.create({ kind: 'rss', label: '慢工博客', level: 'more',
    query: 'https://blog.example.test/feed' });
  const body = rss(Array.from({ length: 14 }, (_, index) => rssItem(index + 1, index * 3,
    `<p>第 ${index + 1} 篇的第一段</p><p>第二段</p><img src="https://img.example.test/${index}.jpg">`)).join(''));
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => new Date(AT),
    fetcher: new FeedFetcher({ request: async () => new Response(body) }) });
  try {
    await subscriptions.refreshNow(source.id);
    const items = t.state.feedItems.listPage({ sourceId: source.id }, {});
    assert.equal(items.length, 10);
    assert.equal(items[0]?.title, '文章 1');
    assert.equal(items.at(-1)?.title, '文章 10');
    assert.deepEqual(items[0]?.body, [{ t: 'p', text: '第 1 篇的第一段' }, { t: 'p', text: '第二段' },
      { t: 'img', text: '', src: 'https://img.example.test/0.jpg' }]);
    assert.equal(items[0]?.summary, '摘要 1');
    // 第二次照旧只收两天内的新文章：旧的不再补进来。
    await subscriptions.refreshNow(source.id);
    assert.equal(t.state.feedItems.listPage({ sourceId: source.id }, {}).length, 10);
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('Reddit 限流只停那一个版块，写清几分钟后再取；别的版块照常取', async () => {
  const t = await openTestState();
  const busy = t.state.feedSources.create({ kind: 'reddit', label: 'r/LocalLLaMA', level: 'normal',
    query: 'https://www.reddit.com/r/LocalLLaMA/hot/.rss' });
  const calm = t.state.feedSources.create({ kind: 'reddit', label: 'r/cogsci', level: 'normal',
    query: 'https://www.reddit.com/r/cogsci/hot/.rss' });
  const asked: string[] = [];
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => new Date(AT),
    fetcher: new FeedFetcher({ request: async (url) => {
      asked.push(url);
      return url.includes('LocalLLaMA') ? new Response('', { status: 429 }) : new Response(redditFeed('cogsci', 3));
    } }), redditGapMs: 0 });
  try {
    assert.equal(subscriptions.scan(), 'started');
    await subscriptions.settled();
    assert.equal(t.state.feedSourceStatus.read(busy.id)?.error, 'Reddit 限流，30 分钟后再取');
    assert.equal(t.state.feedSourceStatus.read(calm.id)?.error, null);
    assert.equal(t.state.feedItems.listPage({ sourceId: calm.id }, {}).length, 3);
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('加 Reddit 版块时把预览取到的存进来，加完马上有内容', async () => {
  const t = await openTestState();
  let reads = 0;
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => new Date(AT),
    fetcher: new FeedFetcher({ request: async () => {
      reads += 1;
      return new Response(redditFeed('LocalLLaMA', 5));
    } }) });
  try {
    const url = 'https://www.reddit.com/r/LocalLLaMA/hot/.rss';
    const preview = await subscriptions.previewReddit(url, new AbortController().signal);
    assert.equal(preview.length, 3);
    const source = t.state.feedSources.create({ kind: 'reddit', label: 'r/LocalLLaMA', level: 'normal', query: url });
    assert.equal(subscriptions.ingestPreview(source.id), 5);
    assert.equal(reads, 1, '不再去取一次');
    assert.equal(t.state.feedItems.listPage({ sourceId: source.id }, {}).length, 5);
    assert.equal(t.state.feedSourceStatus.read(source.id)?.added, 5);
    assert.equal(subscriptions.ingestPreview(source.id), 0, '用过的预览不再用');
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('抓不到说真实原因：连不上、超时、对方出错，不再归成「输入不合要求」', async () => {
  const failing = (reason: () => Promise<Response>) => new FeedFetcher({ request: reason });
  const signal = new AbortController().signal;
  await assert.rejects(failing(async () => { throw new DailyError('unreachable', '连不上这个网站（连接被断开）。'); })
    .get('https://blog.example.test/feed', signal), (error: unknown) => error instanceof DailyError
    && error.code === 'unreachable' && /连不上/.test(error.message));
  await assert.rejects(failing(async () => new Response('', { status: 503 })).get('https://blog.example.test/feed',
    signal), (error: unknown) => error instanceof DailyError && error.code === 'unreachable'
    && error.message === '这个网站出错了（503），过一会儿再试。');
  await assert.rejects(failing(async () => new Response('', { status: 403 })).get('https://blog.example.test/feed',
    signal), (error: unknown) => error instanceof DailyError && error.code === 'unreachable'
    && /拒绝/.test(error.message));
});

test('来源名用网站名：页面声明的订阅链接上写的「Recent Entries」不当名字', async () => {
  const page = '<html><head><title>阮一峰的网络日志</title>'
    + '<link rel="alternate" type="application/atom+xml" title="Recent Entries" href="atom.xml"></head></html>';
  const fetcher = new FeedFetcher({ request: async () => new Response(page) });
  const found = await fetcher.discover('https://www.ruanyifeng.com/blog/', new AbortController().signal);
  assert.deepEqual(found, { url: 'https://www.ruanyifeng.com/blog/atom.xml', title: '阮一峰的网络日志' });
});
