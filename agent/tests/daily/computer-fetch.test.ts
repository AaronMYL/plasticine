// 第13批（11-14 Aaron：「优先服务器抓，抓不到再改由在线的电脑重试」）：服务器取博客、Reddit 连不上、被拒、被限流时，
// 有电脑在线就排一件「替服务器取这个网址」的活；电脑来领、交回正文，解析、入库照服务器自己取到的做。电脑多久没来领
// 就当不在线，不排；同一个来源排着就不再排；领走太久没交的再给一次；交两次只算一次。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ComputerFetches } from '../../src/daily/computer-fetch.ts';
import { DailyError } from '../../src/daily/errors.ts';
import { FeedFetcher } from '../../src/daily/feed-fetch.ts';
import { FeedSubscriptions } from '../../src/daily/feed-subscriptions.ts';
import { openTestState } from '../state/helpers.ts';

const AT = Date.parse('2026-11-14T08:00:00.000Z');
const FEED = '<rss><channel><title>慢工博客</title><item><title>文章 1</title>'
  + '<link>https://blog.example.test/posts/1</link><pubDate>Sat, 14 Nov 2026 07:00:00 GMT</pubDate>'
  + '<description>摘要</description></item></channel></rss>';

test('排活：电脑没来领过就不排；来领过就排，同一个来源只排一件；领走两分钟没交的再给；交回拿走', () => {
  let now = AT;
  const queue = new ComputerFetches(() => new Date(now));
  assert.equal(queue.online(), false);
  assert.equal(queue.ask('https://blog.example.test/feed', { sourceId: 'src_1', discover: false }), false);
  assert.deepEqual(queue.lease(), []);
  assert.equal(queue.online(), true);
  assert.equal(queue.ask('https://blog.example.test/feed', { sourceId: 'src_1', discover: false }), true);
  assert.equal(queue.ask('https://blog.example.test/feed', { sourceId: 'src_1', discover: false }), true);
  const [job, ...rest] = queue.lease();
  assert.equal(rest.length, 0);
  assert.equal(job?.url, 'https://blog.example.test/feed');
  assert.match(job?.id ?? '', /^ff-[A-Za-z0-9-]{8,64}$/);
  assert.deepEqual(queue.lease(), [], '刚领走的不再给');
  now += 2 * 60_000 + 1;
  assert.deepEqual(queue.lease().map((one) => one.id), [job?.id], '领走太久没交的再给一次');
  assert.deepEqual(queue.take(job?.id ?? ''), { url: 'https://blog.example.test/feed',
    purpose: { sourceId: 'src_1', discover: false } });
  assert.equal(queue.take(job?.id ?? ''), undefined, '交两次只算一次');
  now += 3 * 60_000;
  assert.equal(queue.online(), false, '三分钟没来领就当不在线');
});

test('服务器连不上博客：电脑在线就让它去取，来源那一行写清；电脑交回正文后照常入库', async () => {
  const t = await openTestState();
  const source = t.state.feedSources.create({ kind: 'rss', label: '慢工博客', level: 'normal',
    query: 'https://blog.example.test/feed' });
  const computer = new ComputerFetches(() => new Date(AT));
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => new Date(AT), computer,
    fetcher: new FeedFetcher({ request: async () => {
      throw new DailyError('unreachable', '连不上这个网站（连接被断开），过一会儿再试。');
    } }) });
  try {
    await subscriptions.refreshNow(source.id);
    assert.equal(t.state.feedSourceStatus.read(source.id)?.error, '连不上这个网站（连接被断开），过一会儿再试。');
    computer.lease();
    await subscriptions.refreshNow(source.id);
    assert.equal(t.state.feedSourceStatus.read(source.id)?.error,
      '服务器连不上这个网站（连接被断开），已让在线的电脑去取');
    const [job] = computer.lease();
    assert.equal(job?.url, 'https://blog.example.test/feed');
    assert.equal(subscriptions.fetchedByComputer({ requestId: 'ff-report-0001', jobId: job?.id ?? '',
      page: { url: 'https://blog.example.test/feed', text: FEED }, error: null }), true);
    assert.equal(t.state.feedSourceStatus.read(source.id)?.error, null);
    assert.deepEqual(t.state.feedItems.listPage({ sourceId: source.id }, {}).map((item) => item.title), ['文章 1']);
    assert.equal(subscriptions.fetchedByComputer({ requestId: 'ff-report-0002', jobId: job?.id ?? '',
      page: { url: 'https://blog.example.test/feed', text: FEED }, error: null }), false, '交两次只算一次');
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('Reddit 限流时电脑去取；电脑也没取到，来源那一行写两边都没取到', async () => {
  const t = await openTestState();
  const source = t.state.feedSources.create({ kind: 'reddit', label: 'r/LocalLLaMA', level: 'normal',
    query: 'https://www.reddit.com/r/LocalLLaMA/hot/.rss' });
  const computer = new ComputerFetches(() => new Date(AT));
  computer.lease();
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => new Date(AT), computer, redditGapMs: 0,
    fetcher: new FeedFetcher({ request: async () => new Response('', { status: 429 }) }) });
  try {
    await subscriptions.refreshNow(source.id);
    assert.equal(t.state.feedSourceStatus.read(source.id)?.error, 'Reddit 限流，已让在线的电脑去取');
    const [job] = computer.lease();
    subscriptions.fetchedByComputer({ requestId: 'ff-report-0003', jobId: job?.id ?? '', page: null,
      error: { code: 'http_error', status: 429 } });
    assert.equal(t.state.feedSourceStatus.read(source.id)?.error, '服务器和电脑都没取到（对方回了 429）');
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('只给了网站地址的（加的时候服务器连不上）：电脑取回网页，找到订阅地址换上，再让电脑取订阅；没有订阅源就写出来', async () => {
  const t = await openTestState();
  const source = t.state.feedSources.create({ kind: 'rss', label: 'pasqualepillitteri.it', level: 'normal',
    query: 'https://pasqualepillitteri.it/zh' });
  const computer = new ComputerFetches(() => new Date(AT));
  computer.lease();
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => new Date(AT), computer });
  try {
    assert.equal(computer.ask('https://pasqualepillitteri.it/zh', { sourceId: source.id, discover: true }), true);
    const [page] = computer.lease();
    subscriptions.fetchedByComputer({ requestId: 'ff-report-0004', jobId: page?.id ?? '', error: null,
      page: { url: 'https://pasqualepillitteri.it/zh/', text: '<html><head><title>Pasquale 的博客</title>'
        + '<link rel="alternate" type="application/rss+xml" href="/zh/feed/"></head></html>' } });
    const changed = t.state.feedSources.require(source.id);
    assert.equal(changed.query, 'https://pasqualepillitteri.it/zh/feed/');
    assert.equal(changed.label, 'Pasquale 的博客', '名字是网址时换成网站名');
    const [feed] = computer.lease();
    assert.equal(feed?.url, 'https://pasqualepillitteri.it/zh/feed/');
    subscriptions.fetchedByComputer({ requestId: 'ff-report-0005', jobId: feed?.id ?? '', error: null,
      page: { url: 'https://pasqualepillitteri.it/zh/feed/', text: FEED } });
    assert.equal(t.state.feedItems.listPage({ sourceId: source.id }, {}).length, 1);

    const plain = t.state.feedSources.create({ kind: 'rss', label: '没有订阅的站', level: 'normal',
      query: 'https://plain.example.test/' });
    computer.ask('https://plain.example.test/', { sourceId: plain.id, discover: true });
    const [none] = computer.lease();
    subscriptions.fetchedByComputer({ requestId: 'ff-report-0006', jobId: none?.id ?? '', error: null,
      page: { url: 'https://plain.example.test/', text: '<html>没有订阅</html>' } });
    assert.equal(t.state.feedSourceStatus.read(plain.id)?.error, '这个网站没有订阅源');
    assert.equal(t.state.feedSources.require(plain.id).label, '没有订阅的站', '他起的名字不换');
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});
