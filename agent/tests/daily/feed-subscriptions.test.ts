import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { XPost } from '../../shared/api/feed-x.ts';
import { FeedFetcher } from '../../src/daily/feed-fetch.ts';
import { parseFeed } from '../../src/daily/feed-parse.ts';
import { FEED_SOURCE_EVERY_MS, FeedSubscriptions } from '../../src/daily/feed-subscriptions.ts';
import { openTestState } from '../state/helpers.ts';

const AT = '2026-11-04T08:00:00.000Z';

function article(index: number, extra = ''): string {
  return `<item><title>文章 ${index}</title><link>https://blog.example.test/posts/${index}</link>`
    + `<pubDate>${new Date(Date.parse(AT) - index * 60_000).toUTCString()}</pubDate>`
    + `<description><![CDATA[<p>正文 ${index}</p>]]></description>${extra}</item>`;
}
const feed = (items: string) => `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>慢工博客</title>`
  + `${items}</channel></rss>`;

function post(id: string, overrides: Partial<XPost> = {}): XPost {
  return { id, handle: 'linjian_dev', author: '林间', avatar: 'https://pbs.example.test/avatar.jpg',
    text: `第 ${id} 条帖子\n第二行`, image: null, imageRatio: null, publishedAt: AT, ...overrides };
}

test('extracts https subscription images from enclosure, media thumbnail, or body plus author/feed', () => {
  const items = parseFeed(feed(
    article(1, '<enclosure url="https://img.example.test/1.jpg" type="image/jpeg" length="1"/>')
    + article(2, '<media:thumbnail url="https://img.example.test/2.png"/><dc:creator>老周</dc:creator>')
    + article(3).replace('<p>正文 3</p>', '<p>正文 3</p><img src="https://img.example.test/3.webp">')
    + article(4).replace('<p>正文 4</p>', '<img src="http://img.example.test/4.jpg">')),
  'https://blog.example.test/feed', new Date(AT));
  assert.deepEqual(items.map((item) => item.image), ['https://img.example.test/1.jpg',
    'https://img.example.test/2.png', 'https://img.example.test/3.webp', null]);
  assert.equal(items[1]?.author, '老周');
});

test('subscriptions bypass curation with images, dedupe, 3/fetch low tier, 2h cooldown, new only', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  let at = new Date(AT);
  let body = feed([1, 2, 3, 4, 5].map((index) => article(index,
    index === 1 ? '<enclosure url="https://img.example.test/1.jpg" type="image/jpeg"/>' : '')).join(''));
  let reads = 0;
  const source = t.state.feedSources.create({ kind: 'rss', label: '慢工博客', level: 'less',
    query: 'https://blog.example.test/feed' });
  for (let index = 0; index < 10; index += 1) {
    t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: `旧文 ${index}`, dedupeKey: `old-${index}`,
      url: `https://blog.example.test/old/${index}`, day: '2026-11-03', arrivedAt: '2026-11-03T08:00:00.000Z' });
  }
  const added: string[] = [];
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => at,
    fetcher: new FeedFetcher({ request: async () => {
      reads += 1;
      return new Response(body);
    } }), onAdded: (item) => added.push(item.title) });
  try {
    assert.equal(subscriptions.scan(), 'started');
    await subscriptions.settled();
    const first = t.state.feedItems.listPage({}, {}).slice(0, 3);
    assert.deepEqual(first.map((item) => item.title), ['文章 1', '文章 2', '文章 3']);
    assert.equal(first[0]?.imageUrl, 'https://img.example.test/1.jpg');
    assert.equal(first[0]?.sourceId, source.id);
    assert.equal(first[0]?.summary, '正文 1');
    assert.deepEqual(added.sort(), ['文章 1', '文章 2', '文章 3']);
    assert.equal(t.state.feedSourceStatus.read(source.id)?.error, null);
    assert.equal(subscriptions.scan(), 'skipped');
    at = new Date(Date.parse(AT) + FEED_SOURCE_EVERY_MS);
    body = feed([0, 1, 2, 3, 4, 5].map((index) => article(index)).join(''));
    assert.equal(subscriptions.scan(), 'started');
    await subscriptions.settled();
    assert.equal(reads, 2);
    assert.deepEqual(t.state.feedItems.listPage({}, {}).map((item) => item.title).slice(0, 4),
      ['文章 0', '文章 4', '文章 5', '文章 1']);
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('records fetch error on subscription and clears on next success; disabled subscriptions skip', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  let at = new Date(AT);
  let broken = true;
  const source = t.state.feedSources.create({ kind: 'rss', label: '坏掉的', query: 'https://blog.example.test/feed' });
  t.state.feedSources.create({ kind: 'rss', label: '关掉的', level: 'off', query: 'https://off.example.test/feed' });
  const asked: string[] = [];
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => at,
    fetcher: new FeedFetcher({ request: async (url) => {
      asked.push(new URL(url).hostname);
      return broken ? new Response('', { status: 503 }) : new Response(feed(article(1)));
    } }) });
  try {
    subscriptions.scan();
    await subscriptions.settled();
    assert.equal(t.state.feedSourceStatus.read(source.id)?.error, '这个网站出错了（503），过一会儿再试。');
    broken = false;
    at = new Date(Date.parse(AT) + FEED_SOURCE_EVERY_MS);
    subscriptions.scan();
    await subscriptions.settled();
    const status = t.state.feedSourceStatus.read(source.id);
    assert.equal(status?.error, null);
    assert.equal(status?.added, 1);
    assert.deepEqual([...new Set(asked)], ['blog.example.test']);
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('X posts poll on schedule with author/avatar/media, dedupe batch, match interests, log auth err', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  let at = new Date(AT);
  const concern = { id: 'interest:个人 AI' };
  t.state.feedSources.create({ kind: 'interest', label: '个人 AI', concernId: concern.id });
  t.state.feedSources.create({ kind: 'interest', label: '关掉的词', level: 'off' });
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => at });
  try {
    assert.deepEqual(subscriptions.xDue(), { due: true, everyMinutes: 120 });
    const report = { requestId: 'x-read-0001', error: null, posts: [
      post('101', { text: '把记忆拆成两栏以后，我的个人 AI 纠错少了一半', image: 'https://pbs.example.test/m.jpg',
        imageRatio: 0.75 }),
      post('102', { text: '关掉的词不该命中' }),
      post('103', { text: '' }),
    ] };
    assert.equal(subscriptions.ingestX(report), 3);
    assert.equal(subscriptions.ingestX(report), 0);
    assert.deepEqual(subscriptions.xDue(), { due: false, everyMinutes: 120 });
    const items = t.state.feedItems.listPage({ kind: 'x' }, {});
    assert.equal(items.length, 3);
    const hit = items.find((item) => item.dedupeKey === 'x:101');
    assert.equal(hit?.concernId, concern.id);
    assert.equal(hit?.topic, '个人 AI');
    assert.equal(hit?.imageUrl, 'https://pbs.example.test/m.jpg');
    assert.equal(hit?.imageRatio, 0.75);
    assert.equal(hit?.url, 'https://x.com/linjian_dev/status/101');
    assert.equal(hit?.author, '林间');
    assert.equal(hit?.authorHandle, 'linjian_dev');
    assert.equal(items.find((item) => item.dedupeKey === 'x:102')?.concernId, null);
    assert.equal(items.find((item) => item.dedupeKey === 'x:103')?.title, '@linjian_dev');
    assert.equal(items[0]?.dedupeKey, 'x:101');
    assert.equal(t.state.feedItems.listPage({ kind: 'rss' }, {}).length, 0);

    at = new Date(Date.parse(AT) + FEED_SOURCE_EVERY_MS);
    assert.equal(subscriptions.xDue().due, true);
    assert.equal(subscriptions.ingestX({ requestId: 'x-read-0002', posts: [], error: { code: 'signed_out' } }), 0);
    const x = subscriptions.builtIn('x');
    assert.equal(t.state.feedSourceStatus.read(x.id)?.error, '在 Plasticine 浏览器里登录 X');
    assert.equal(subscriptions.ingestX({ requestId: 'x-read-0003', posts: [],
      error: { code: 'layout_changed', detail: '找不到帖子' } }), 0);
    assert.equal(t.state.feedSourceStatus.read(x.id)?.error, 'X 改版了，这次没读到帖子：找不到帖子');

    t.state.feedSources.update(x.id, x.version, { level: 'off' });
    at = new Date(Date.parse(AT) + 3 * FEED_SOURCE_EVERY_MS);
    assert.equal(subscriptions.xDue().due, false);
    assert.equal(subscriptions.ingestX({ requestId: 'x-read-0004', error: null, posts: [post('104')] }), 0);
  } finally {
    await t.cleanup();
  }
});

test('subscription under an interest tags items with it and stops ingesting when interest disabled', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  const concern = { id: 'interest:同步' };
  const interest = t.state.feedSources.create({ kind: 'interest', label: '同步', concernId: concern.id });
  t.state.feedSources.create({ kind: 'rss', label: '挂着的订阅', concernId: concern.id,
    query: 'https://blog.example.test/feed' });
  let at = new Date(AT);
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => at,
    fetcher: new FeedFetcher({ request: async () => new Response(feed(article(1) + article(2))) }) });
  try {
    subscriptions.scan();
    await subscriptions.settled();
    assert.ok(t.state.feedItems.listPage({}, {}).every((item) => item.concernId === concern.id));
    t.state.feedSources.update(interest.id, interest.version, { level: 'off' });
    at = new Date(Date.parse(AT) + FEED_SOURCE_EVERY_MS);
    subscriptions.scan();
    await subscriptions.settled();
    assert.equal(t.state.feedItems.listPage({}, {}).length, 2);
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});
