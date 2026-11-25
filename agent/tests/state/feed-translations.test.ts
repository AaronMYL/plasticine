import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { FEED_TRANSLATE_ATTEMPTS_MAX } from '../../src/state/feed-translations.ts';
import { openTestState, type TestState } from './helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

function addItem(key: string, reaction: 'dislike' | null = null): string {
  const source = t.state.feedSources.ensure({ ref: 'rss:test', kind: 'rss', label: '测试订阅', level: 'normal' });
  const { item } = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: `Post ${key}`,
    summary: 'An English post.', dedupeKey: key, day: '2026-11-07', arrivedAt: '2026-11-07T08:00:00.000Z' });
  if (reaction !== null) {
    t.state.feedItems.update(item.id, item.version, { reaction });
  }
  return item.id;
}

test('New feed item queues translation, writes text/charts without bumping item version', () => {
  const id = addItem('a');
  const before = t.state.feedItems.require(id).version;
  t.state.feedTranslations.queue(id);
  t.state.feedTranslations.queue(id);
  assert.deepEqual(t.state.feedTranslations.next(10), [id]);
  const chart = { kind: 'line' as const, caption: '月销量', source: '行业协会', points: [
    { label: '1月', value: 10 }, { label: '2月', value: 12 }, { label: '3月', value: 15 }] };
  t.state.feedTranslations.finish(id, { lang: 'en', title: '帖子', text: '一条英文帖子。', digest: null, chart,
    model: 'test' });
  const row = t.state.feedTranslations.get(id);
  assert.equal(row?.state, 'done');
  assert.equal(row?.text, '一条英文帖子。');
  assert.deepEqual(row?.chart, chart);
  assert.equal(t.state.feedItems.require(id).version, before);
  assert.deepEqual(t.state.feedTranslations.next(10), []);
});

test('Simplified Chinese source marks skipped; failures back off and stop at max tries', () => {
  const zh = addItem('zh');
  const en = addItem('en');
  t.state.feedTranslations.queue(zh);
  t.state.feedTranslations.queue(en);
  t.state.feedTranslations.finish(zh, { lang: 'zh-Hans', title: null, text: null, digest: null, chart: null,
    model: null });
  assert.equal(t.state.feedTranslations.get(zh)?.state, 'skipped');
  for (let attempt = 0; attempt < FEED_TRANSLATE_ATTEMPTS_MAX; attempt += 1) {
    assert.deepEqual(t.state.feedTranslations.next(10), [en]);
    t.state.feedTranslations.fail(en, '模型连不上');
  }
  assert.deepEqual(t.state.feedTranslations.next(10), []);
  t.state.feedTranslations.retry(en);
  assert.deepEqual(t.state.feedTranslations.next(10), [en]);
});

test('Backfill queues old items, skipping dismissed and already-queued entries', () => {
  const kept = addItem('old');
  addItem('hidden', 'dislike');
  const done = addItem('done');
  t.state.feedTranslations.queue(done);
  t.state.feedTranslations.finish(done, { lang: 'en', title: '好', text: '好', digest: null, chart: null, model: null });
  assert.equal(t.state.feedTranslations.backfill('2026-11-01T00:00:00.000Z', 100), 1);
  assert.deepEqual(t.state.feedTranslations.next(10), [kept]);
  assert.equal(t.state.feedTranslations.backfill('2026-11-01T00:00:00.000Z', 100), 0);
  assert.equal(t.state.feedTranslations.many([kept, done]).size, 2);
  addItem('later');
  assert.equal(t.state.feedTranslations.backfill('2026-11-08T00:00:00.000Z', 100), 0);
});
