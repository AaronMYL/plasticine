import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { redditFeedOf, redditFeedUrl, subredditOf } from '../../shared/reddit.ts';
import { FeedFetcher } from '../../src/daily/feed-fetch.ts';
import { parseFeed } from '../../src/daily/feed-parse.ts';
import { FEED_SOURCE_EVERY_MS, FeedSubscriptions } from '../../src/daily/feed-subscriptions.ts';
import { REDDIT_WINDOW_MS, redditPost } from '../../src/daily/reddit.ts';
import { openTestState } from '../state/helpers.ts';

const SAMPLE = readFileSync(new URL('./fixtures/reddit-neuroscience.xml', import.meta.url), 'utf8');
const AT = '2026-11-08T10:30:00.000Z';
const URL_HOT = 'https://www.reddit.com/r/neuroscience/.rss';

test('subreddit parser accepts r/ prefix, URL, slashes; round-trips sort option through URL', () => {
  assert.equal(subredditOf('r/neuroscience'), 'neuroscience');
  assert.equal(subredditOf(' /r/cogsci/ '), 'cogsci');
  assert.equal(subredditOf('https://www.reddit.com/r/AskScience/top/?t=week'), 'AskScience');
  assert.equal(subredditOf('不是版块'), null);
  assert.equal(subredditOf('r/a'), null);
  assert.equal(redditFeedUrl('neuroscience', 'hot'), URL_HOT);
  assert.equal(redditFeedUrl('neuroscience', 'new'), 'https://www.reddit.com/r/neuroscience/new/.rss');
  assert.equal(redditFeedUrl('neuroscience', 'top_week'), 'https://www.reddit.com/r/neuroscience/top/.rss?t=week');
  for (const sort of ['hot', 'new', 'top_week'] as const) {
    assert.deepEqual(redditFeedOf(redditFeedUrl('cogsci', sort)), { subreddit: 'cogsci', sort });
  }
  assert.equal(redditFeedOf('https://blog.example.test/feed'), null);
});

test('parses real Reddit Atom: strips submitted-by footer, extracts u/author, post link, thumbnail', () => {
  const now = new Date(AT);
  const posts = parseFeed(SAMPLE, URL_HOT, now, REDDIT_WINDOW_MS).map(redditPost);
  assert.equal(posts.length, 3);
  const [first, second, old] = posts;
  assert.equal(first?.title, 'Hippocampal time cells replay in order during maze runs');
  assert.equal(first?.author, 'u/synapse_lab');
  assert.equal(first?.text,
    'New single-unit recordings show hippocampal time cells replay in order while mice run a maze.');
  assert.equal(first?.url, 'https://www.reddit.com/r/neuroscience/comments/1gm2abc/hippocampal_time_cells_replay/');
  assert.equal(second?.text, '');
  assert.equal(second?.author, 'u/attn_matters');
  assert.equal(second?.image, 'https://b.thumbs.redditmedia.com/attn.jpg');
  assert.equal(old?.author, 'u/old_poster');
  assert.equal(parseFeed(SAMPLE, URL_HOT, now).length, 2);
});

test('Reddit subreddit feeds directly into feed, filters by type/source, excludes News, respects 429', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  let at = new Date(AT);
  let status = 200;
  let reads = 0;
  const reddit = t.state.feedSources.create({ kind: 'reddit', label: 'r/neuroscience', query: URL_HOT });
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => at,
    fetcher: new FeedFetcher({ request: async () => {
      reads += 1;
      return status === 200 ? new Response(SAMPLE) : new Response('', { status });
    } }) });
  try {
    assert.equal(subscriptions.scan(), 'started');
    await subscriptions.settled();
    const items = t.state.feedItems.listPage({ kind: 'reddit' }, {});
    assert.equal(items.length, 3);
    assert.ok(items.every((item) => item.sourceId === reddit.id));
    const first = items.find((item) => item.title.startsWith('Hippocampal'));
    assert.equal(first?.author, 'u/synapse_lab');
    assert.equal(first?.site, 'www.reddit.com');
    assert.equal(t.state.feedItems.listPage({ kind: 'news' }, {}).length, 0);
    assert.equal(t.state.feedItems.listPage({ kind: 'rss' }, {}).length, 0);
    assert.equal(t.state.feedItems.listPage({ sourceId: reddit.id }, {}).length, 3);

    status = 429;
    at = new Date(Date.parse(AT) + FEED_SOURCE_EVERY_MS);
    subscriptions.scan();
    await subscriptions.settled();
    assert.match(t.state.feedSourceStatus.read(reddit.id)?.error ?? '', /限流/);
    t.state.feedSourceStatus.expire(reddit.id);
    at = new Date(Date.parse(AT) + FEED_SOURCE_EVERY_MS + 10 * 60_000);
    assert.equal(subscriptions.scan(), 'skipped');
    assert.equal(reads, 2);
    status = 200;
    assert.equal(await subscriptions.refreshNow(reddit.id), 0);
    assert.equal(reads, 3);
    assert.equal(t.state.feedSourceStatus.read(reddit.id)?.error, null);
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});

test('deleting source hides and stops fetch, removes unsaved items keeping saved, re-adding restores', async () => {
  const t = await openTestState();
  t.state.dailySettings.save(0, { timeZone: 'UTC' });
  const at = new Date(AT);
  let reads = 0;
  const source = t.state.feedSources.ensure({ kind: 'reddit', label: 'r/neuroscience', query: URL_HOT,
    ref: 'reddit:neuroscience', level: 'normal' });
  const subscriptions = new FeedSubscriptions({ state: t.state, now: () => at,
    fetcher: new FeedFetcher({ request: async () => {
      reads += 1;
      return new Response(SAMPLE);
    } }) });
  try {
    subscriptions.scan();
    await subscriptions.settled();
    const [kept] = t.state.feedItems.listPage({}, {});
    assert.ok(kept !== undefined);
    t.state.feedItems.update(kept.id, kept.version, { savedAt: AT });
    t.state.feedSources.remove(source.id, t.state.feedSources.require(source.id).version);
    assert.deepEqual(t.state.feedSources.all({ kind: 'reddit' }), []);
    assert.equal(t.state.feedSources.removed(source.id), true);
    assert.deepEqual(t.state.feedItems.listPage({}, {}).map((item) => item.id), [kept.id]);
    assert.deepEqual(t.state.feedItems.listPage({ saved: true }, {}).map((item) => item.id), [kept.id]);
    assert.equal(t.state.feedItems.countBySource(new Date(0).toISOString(), '9999-12-31').get(source.id), 1);
    assert.equal(subscriptions.scan(), 'skipped');

    const back = t.state.feedSources.ensure({ kind: 'reddit', label: 'r/neuroscience', query: URL_HOT,
      ref: 'reddit:neuroscience', level: 'normal' });
    assert.equal(back.id, source.id);
    assert.equal(back.level, 'normal');
    assert.equal(t.state.feedSources.removed(source.id), false);
    assert.equal(t.state.feedItems.listPage({}, {}).length, 3);
    assert.equal(reads, 1);
  } finally {
    await subscriptions.stop();
    await t.cleanup();
  }
});
