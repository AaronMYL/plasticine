import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { FeedTranslationInput, FeedTranslationReply } from '../../shared/feed-translation.ts';
import type { FeedItem } from '../../shared/state.ts';
import { checkedChart, numbersIn } from '../../src/daily/feed-chart-check.ts';
import { FeedTranslations } from '../../src/daily/feed-translate.ts';
import { feedItemView } from '../../src/app/daily-views.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

const NOW = new Date('2026-11-07T08:00:00.000Z');
const LONG = 'We handed 4,800 backtested strategies to a model for three months. '.repeat(6);

function add(kind: 'x' | 'rss', key: string, summary: string): FeedItem {
  const source = kind === 'x'
    ? t.state.feedSources.ensure({ ref: 'x:following', kind: 'x', label: 'X', level: 'normal' })
    : t.state.feedSources.ensure({ ref: 'rss:a', kind: 'rss', label: 'Blog', level: 'normal' });
  return t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: kind === 'x' ? summary : 'EV sales',
    summary, dedupeKey: key, day: '2026-11-07', arrivedAt: NOW.toISOString() }).item;
}

function worker(reply: (input: FeedTranslationInput) => FeedTranslationReply, seen: FeedTranslationInput[] = []) {
  const changed: string[] = [];
  const translations = new FeedTranslations({ state: t.state, now: () => NOW,
    isPost: (item) => t.state.feedSources.get(item.sourceId)?.kind === 'x',
    changed: (item) => changed.push(item.id),
    translate: async (input) => { seen.push(input); return reply(input); } });
  return { translations, changed };
}

test('抓到的英文帖入库就翻：短帖存中文全文，长帖另存中文摘要，显示时不再翻', async () => {
  const short = add('x', 'short', 'Do not lead with numbers.');
  const long = add('x', 'long', LONG);
  const seen: FeedTranslationInput[] = [];
  const { translations, changed } = worker((input) => ({ lang: 'en', title: '不该留', text: `译：${input.text.slice(0, 8)}`,
    digest: '摘要：简单规则活下来。', chart: null }), seen);
  translations.added(short);
  translations.added(long);
  await translations.settled();
  assert.deepEqual(seen.map((input) => input.post), [true, true]);
  const shortRow = t.state.feedTranslations.get(short.id);
  assert.equal(shortRow?.text, '译：Do not l');
  assert.equal(shortRow?.title, null, 'X 的帖子没有标题');
  assert.equal(shortRow?.digest, null, '短帖不要摘要');
  assert.equal(t.state.feedTranslations.get(long.id)?.digest, '摘要：简单规则活下来。');
  assert.deepEqual(changed.sort(), [short.id, long.id].sort());
  const view = feedItemView(t.state, t.state.feedItems.require(long.id), null);
  assert.equal(view.zh?.from, '英文');
  assert.equal(view.zh?.state, 'done');
});

test('图表的数字必须在原文里出现过，编的整张不要', async () => {
  const item = add('rss', 'ev', 'Monthly EV sales rose: 98,000 in July, 101,500 in August and 104,200 in September.');
  const { translations } = worker(() => ({ lang: 'en', title: '电动车销量回升', text: '…', digest: null,
    chart: { kind: 'line', caption: '月销量', source: '行业协会', points: [
      { label: '7月', value: 98000 }, { label: '8月', value: 101500 }, { label: '9月', value: 104200 }] } }));
  translations.added(item);
  await translations.settled();
  assert.equal(feedItemView(t.state, t.state.feedItems.require(item.id), null).chart?.points.length, 3);
  const made = { kind: 'bar' as const, caption: 'x', source: 'y', points: [
    { label: 'a', value: 98000 }, { label: 'b', value: 1 }, { label: 'c', value: 104200 }] };
  assert.equal(checkedChart(made, 'Sales were 98,000 and 104,200.'), null);
  assert.ok(numbersIn('12.5% of 4,800').has(4800));
});

test('简体中文原文不翻；没翻成记原因，下次扫描再翻；扫描补排最近的旧条目', async () => {
  const zh = add('rss', 'zh', '用 SQLite 做全文搜索，中文要换 trigram。');
  const { translations } = worker(() => ({ lang: 'zh-Hans', title: null, text: null, digest: null, chart: null }));
  translations.scan();
  await translations.settled();
  assert.equal(t.state.feedTranslations.get(zh.id)?.state, 'skipped');
  assert.equal(feedItemView(t.state, t.state.feedItems.require(zh.id), null).zh?.from, null);

  const en = add('rss', 'en', 'Hello');
  const failing = new FeedTranslations({ state: t.state, now: () => NOW, isPost: () => false, changed: () => undefined,
    translate: async () => { throw new Error('模型连不上'); } });
  failing.added(en);
  await failing.settled();
  assert.equal(t.state.feedTranslations.get(en.id)?.state, 'failed');
  assert.equal(t.state.feedTranslations.get(en.id)?.attempts, 1, '同一轮里不连着重试');
  assert.match(t.state.feedTranslations.get(en.id)?.error ?? '', /模型连不上/);
  assert.equal(feedItemView(t.state, t.state.feedItems.require(en.id), null).zh?.state, 'failed');
});

test('译文进全文索引：搜中文能找到英文帖', async () => {
  const item = add('rss', 'search', 'Rules that survive are the simplest ones.');
  const { translations } = worker(() => ({ lang: 'en', title: '活下来的规则', text: '活下来的都是最简单的规则。',
    digest: null, chart: null }));
  translations.added(item);
  await translations.settled();
  const found = t.state.search.find({ q: '最简单的规则' });
  assert.ok(found.some((hit) => hit.objectId === item.id));
});
