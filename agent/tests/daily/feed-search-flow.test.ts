import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FeedSelector } from '../../shared/feed-selection.ts';
import { ExternalFeed } from '../../src/daily/external-feed.ts';
import { FeedFetcher } from '../../src/daily/feed-fetch.ts';
import { collectCandidates, sourceSearchTerms } from '../../src/daily/feed-candidates.ts';
import { openTestState } from '../state/helpers.ts';

const AT = '2026-10-29T08:00:00.000Z';
const DAY = '2026-10-29';
function story(index: number, options: { url?: string; date?: string; title?: string; text?: string } = {}): string {
  return `<item><title>${options.title ?? `新闻 ${index}`}</title>`
    + `<link>${options.url ?? `https://news.example.test/articles/${index}`}</link>`
    + `<description>${options.text ?? '原文摘要。'}</description>`
    + `<pubDate>${options.date ?? AT}</pubDate></item>`;
}
const rss = (items: string) => `<rss><channel>${items}</channel></rss>`;

test('搜索单词失败只记一次且不拖累另一词，所有过滤规则在一次选材前生效', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC', feedBannedTerms: ['不要词'] });
  const interest = t.state.feedSources.create({ kind: 'interest', label: '失败与成功', query: '原说明' },
    { migratedDefault: true, legacyPayload: { row: { origin: 'reading', queryEdited: false } } });
  t.state.feedSources.create({ kind: 'blocked_site', label: 'www.blocked.test', level: 'off' });
  const existing = t.state.feedItems.add({ sourceId: interest.id, origin: 'feed', title: '已见过',
    url: 'https://news.example.test/articles/1', day: DAY, arrivedAt: AT, dedupeKey: 'legacy:item' }).item;
  t.state.feedItems.update(existing.id, existing.version, { seenAt: AT, reaction: 'dislike' });
  const body = rss(story(1) + story(2, { url: 'https://blocked.test/articles/2' })
    + story(3, { url: 'https://news.example.test/' }) + story(4, { date: '2026-10-26T00:00:00Z' })
    + story(5, { title: '含不要词' }) + story(6, { text: '摘要含不要词' }) + story(7) + story(7));
  let calls = 0;
  const desk = new ExternalFeed({ state: t.state, now: () => new Date(AT),
    fetcher: new FeedFetcher({ request: async (url) => {
      if (new URL(url).searchParams.get('q') === '失败') { throw new Error('假失败'); }
      return new Response(body);
    } }),
    select: async (input) => {
      calls += 1;
      assert.deepEqual(input.candidates.map((row) => row.title), ['新闻 7']);
      return { items: [] };
    },
  });
  try {
    assert.equal(desk.scan(), 'started');
    await desk.settled();
    assert.equal(calls, 1);
    assert.match(t.state.feedFetchRuns.read(DAY)?.error ?? '', /1 个搜索词或订阅没抓到.*假失败/);
    assert.equal(t.state.feedItems.page({}, {}).length, 0);
  } finally { await desk.stop(); await t.cleanup(); }
});

test('只写已判断相关的两条，不补无关新闻；来源带实际关注点和探索方向；订阅不进选材', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  // 关注点的分组键（原来是关切 id，2026-11-05 起是 interest:<来源>）。
  const concern = { id: 'interest:技术' };
  const interest = t.state.feedSources.create({ kind: 'interest', label: '技术', concernId: concern.id });
  t.state.feedSources.create({ kind: 'rss', label: '订阅站', query: 'https://rss.example.test/feed',
    concernId: concern.id });
  const desk = new ExternalFeed({ state: t.state, now: () => new Date(AT),
    fetcher: new FeedFetcher({ request: async (url) => new Response(new URL(url).hostname === 'www.bing.com'
      ? rss(Array.from({ length: 12 }, (_, i) => story(i)).join(''))
      : rss(story(99, { url: 'https://rss.example.test/article-99' }))) }),
    select: async (input) => {
      assert.ok(input.candidates.some((row) => row.via === '搜索'));
      // 第 3 批（11-04）：订阅直接进信息流（feed-subscriptions.ts），不再交给模型挑。
      assert.ok(!input.candidates.some((row) => row.url.startsWith('https://rss.example.test/')));
      return { items: input.candidates.slice(0, 2).map((row) => ({ id: row.id, sourceId: input.interests[0]?.id ?? null, summary: '中文摘要。第二句。',
        why: '你关注技术。', event: row.id })) };
    },
  });
  try {
    desk.scan();
    await desk.settled();
    const items = t.state.feedItems.page({}, {});
    assert.equal(items.length, 2);
    assert.ok(items.every((row) => row.sourceId === interest.id && row.topic === '技术' && row.concernId === concern.id));
    assert.ok(items.some((row) => row.summary === '中文摘要。第二句。'));
    const liked = items[0];
    assert.ok(liked);
    t.state.feedItems.update(liked.id, liked.version, { reaction: 'like' });
    assert.equal(t.state.feedItems.reactionScores('2026-09-29T00:00:00Z').get(interest.id), 1);
    const hidden = t.state.feedItems.require(liked.id);
    t.state.feedItems.update(hidden.id, hidden.version, { reaction: 'dislike' });
    assert.equal(t.state.feedItems.reactionScores('2026-09-29T00:00:00Z').get(interest.id), -2);
    assert.equal(t.state.feedItems.reactionScores('2026-11-01T00:00:00Z').size, 0);
  } finally { await desk.stop(); await t.cleanup(); }
});

test('模型不可用不写未经判断的新闻，搜索只取前八个非关闭关注点', async () => {
  for (const unavailable of [true, false]) {
    const t = await openTestState();
    t.state.dailySettings.save(0, { timeZone: 'UTC' });
    for (let i = 0; i < 10; i += 1) {
      t.state.feedSources.create({ kind: 'interest', label: `主题${i}`, level: i === 9 ? 'more' : 'normal' });
    }
    t.state.feedSources.create({ kind: 'interest', label: '关掉', level: 'off' });
    const queries = new Set<string>();
    const select: FeedSelector = async () => {
      if (unavailable) { throw new Error('假模型离线'); }
      return { items: [] };
    };
    const desk = new ExternalFeed({ state: t.state, now: () => new Date(AT), select,
      fetcher: new FeedFetcher({ request: async (raw) => {
        const url = new URL(raw);
        const query = url.searchParams.get('q') ?? '';
        queries.add(query);
        return new Response(url.pathname === '/news/search' ? rss('')
          : rss(story(1, { title: query, url: `https://news.example.test/articles/${encodeURIComponent(query)}` })));
      } }),
    });
    try {
      desk.scan();
      await desk.settled();
      assert.equal(queries.size, 8);
      assert.ok(queries.has('主题9'));
      assert.ok(!queries.has('关掉'));
      const items = t.state.feedItems.page({}, {});
      assert.equal(items.length, 0);
      assert.ok(items.every((row) => row.publishedAt === null));
      // 第 3 批：这一路没成（11-04 模型额度用完那种）的原因记在「按关注点搜新闻」那一行上。
      const news = t.state.feedSources.byRef('internal:news');
      const status = news === undefined ? undefined : t.state.feedSourceStatus.read(news.id);
      if (unavailable) { assert.match(status?.error ?? '', /选材未完成：假模型离线/); }
      else { assert.equal(status?.error, null); }
    } finally { await desk.stop(); await t.cleanup(); }
  }
});

test('迁移关注点保留旧版自定义查询，编辑查询后不再拆词', async () => {
  const t = await openTestState();
  try {
    const source = t.state.feedSources.create({ kind: 'interest', label: '技术与教育', query: '长说明' },
      { migratedDefault: true, legacyPayload: { row: { origin: 'reading', queryEdited: false } } });
    assert.deepEqual(sourceSearchTerms(source), ['技术', '教育']);
    assert.deepEqual(sourceSearchTerms(t.state.feedSources.update(source.id, source.version,
      { query: 'AI & learning', queryEdited: true })), ['AI & learning']);
    const custom = t.state.feedSources.create({ kind: 'interest', label: '技术与教育', query: '定制查询' },
      { migratedDefault: true, legacyPayload: { row: { origin: 'user', queryEdited: false } } });
    assert.deepEqual(sourceSearchTerms(custom), ['定制查询']);
  } finally { await t.cleanup(); }
});

test('近期赞和不感兴趣影响下一次前八关注点，30天以前的反应不再影响', async () => {
  const t = await openTestState();
  const sources = Array.from({ length: 9 }, (_, i) =>
    t.state.feedSources.create({ kind: 'interest', label: `主题${i}` }));
  const target = sources[8];
  assert.ok(target);
  const item = t.state.feedItems.add({ sourceId: target.id, origin: 'feed', title: '反应对象',
    day: DAY, arrivedAt: AT, dedupeKey: 'react-to-this' }).item;
  const fetcher = new FeedFetcher({ request: async () => new Response(rss('')) });
  try {
    const liked = t.state.feedItems.update(item.id, item.version, { reaction: 'like' });
    const first = await collectCandidates(t.state, fetcher, new Date(AT), AbortSignal.timeout(1_000));
    assert.equal(first.interests[0]?.id, target.id);
    t.state.feedItems.update(liked.id, liked.version, { reaction: 'dislike' });
    const second = await collectCandidates(t.state, fetcher, new Date(AT), AbortSignal.timeout(1_000));
    assert.ok(!second.interests.some((source) => source.id === target.id));
    const old = await collectCandidates(t.state, fetcher, new Date('2026-12-01'), AbortSignal.timeout(1_000));
    assert.equal(old.interests[0]?.id, sources[0]?.id);
  } finally { await t.cleanup(); }
});

test('停机取消忽略信号的模型；待排队刷新保留，重建服务只接队列不重放运行中的调用', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  t.state.feedSources.create({ kind: 'interest', label: '技术' });
  let called = false;
  const fetcher = new FeedFetcher({ request: async () => new Response(rss(story(1))) });
  const desk = new ExternalFeed({ state: t.state, now: () => new Date(AT), fetcher,
    select: async () => { called = true; return new Promise(() => {}); } });
  try {
    desk.queueRefresh('stop-one');
    desk.resume();
    desk.queueRefresh('stop-two');
    while (!called) { await new Promise<void>((resolve) => setImmediate(resolve)); }
    await desk.stop();
    assert.equal(t.state.feedFetchRuns.refresh('stop-one')?.status, 'failed');
    assert.equal(t.state.feedFetchRuns.refresh('stop-two')?.status, 'queued');
    const next = new ExternalFeed({ state: t.state, now: () => new Date(AT), fetcher,
      select: async () => ({ items: [] }) });
    try {
      next.resume();
      await next.settled();
      assert.equal(t.state.feedFetchRuns.refresh('stop-two')?.status, 'completed');
      assert.equal(t.state.feedItems.page({}, {}).length, 0);
      assert.equal(next.queueRefresh('stop-one').status, 'failed');
    } finally { await next.stop(); }
  } finally { await desk.stop(); await t.cleanup(); }
});

