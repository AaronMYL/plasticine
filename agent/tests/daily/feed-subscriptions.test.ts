// 第 3 批信息流（用户 11-04 定）：订阅和 X 上他关注的人直接进信息流，不经模型选材；去重、按档位限条数、字面命中
// 关注点；订阅每 2 小时抓一次，抓不到 / 读不到的原因记在来源状态上（设置那一行写出来）。

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

test('订阅的配图：附件、media 缩略图、正文第一张图；只要 https 的；作者和订阅源名字', () => {
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

test('订阅直接进信息流不经选材：配图、去重、少档每次三条；两小时内不再抓，到点只加新的', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  let at = new Date(AT);
  let body = feed([1, 2, 3, 4, 5].map((index) => article(index,
    index === 1 ? '<enclosure url="https://img.example.test/1.jpg" type="image/jpeg"/>' : '')).join(''));
  let reads = 0;
  const source = t.state.feedSources.create({ kind: 'rss', label: '慢工博客', level: 'less',
    query: 'https://blog.example.test/feed' });
  // 已经收过十篇的老订阅（第13批：收得少的博客会往前多导入几篇，这里看的是之后每一轮的条数）。
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
    // 少档一次三条：最新的三篇，列表里新发的在前。
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

test('抓不到把原因记在这个订阅上，下一次抓到了就清掉；关掉的订阅不抓', async () => {
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

test('X 的帖子：到点才读，入库带作者、头像和配图；同一批再交不出两条；字面命中关注点；没登录只记原因', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  let at = new Date(AT);
  // 关注点的分组键（原来是关切 id，2026-11-05 起是 interest:<来源>）。
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
    // 命中关注点的排前面（同一天里）。
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

test('订阅挂在关注点上：条目带那个关注点；关注点关掉了这一路也不进', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  // 关注点的分组键（原来是关切 id，2026-11-05 起是 interest:<来源>）。
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
