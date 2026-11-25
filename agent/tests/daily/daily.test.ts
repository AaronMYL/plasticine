import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  checkUrl,
  linkKey,
  createDaily,
  DailyError,
  dayRange,
  dayStartOf,
  localDay,
  localDayStart,
  type Daily,
} from '../../src/daily/index.ts';
import { CREDENTIAL_PARAMS } from '../safety-helpers.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

const NOW = new Date('2026-10-27T08:30:00.000Z');
const immediately = (action: () => void): void => action();

let t: TestState;
let daily: Daily;

beforeEach(async () => {
  t = await openTestState();
  daily = createDaily({ state: t.state, now: () => NOW });
});

afterEach(async () => {
  await t.cleanup();
});

test('validates URL without sanitizing: rejects non-http(s) without echo, keeps params and fragment', () => {
  const raw = 'https://me:secret@example.com/p?id=7&access_token=abc&X-Amz-Signature=s&keyword=ai#top';
  assert.equal(checkUrl(raw), raw);
  assert.throws(() => checkUrl('javascript:alert(1)'), DailyError);
  assert.throws(() => checkUrl('不是网址 token=abc'), (error: unknown) => {
    return error instanceof DailyError && !error.message.includes('token=abc');
  });
  assert.equal(linkKey(raw), 'https://example.com/p?id=7&keyword=ai');
});

test('computes today in user timezone: Shanghai 10-27 16:30 starts at UTC 10-26 16:00', () => {
  assert.equal(localDay(NOW, 'Asia/Shanghai'), '2026-10-27');
  assert.equal(localDayStart(NOW, 'Asia/Shanghai').toISOString(), '2026-10-26T16:00:00.000Z');
});

test('counts today\'s new items over full local day range excluding tomorrow and later', () => {
  const sourceId = daily.feed.source('manual').id;
  for (const [index, arrivedAt] of [
    '2026-10-26T15:59:59.999Z', '2026-10-26T16:00:00.000Z',
    '2026-10-27T15:59:59.999Z', '2026-10-27T16:00:00.000Z',
  ].entries()) {
    t.state.feedItems.add({
      sourceId, origin: 'manual', title: `边界 ${index}`, dedupeKey: `boundary:${index}`,
      day: '2026-10-27', arrivedAt,
    });
  }
  assert.equal(daily.feed.newToday('Asia/Shanghai'), 2);
});

test('manual feed item add creates only one entry per request', () => {
  const url = 'https://example.com/a';
  const input = { requestId: 'req-00000001', title: '一篇讲 agent 的文章', url };
  const item = daily.feed.addManual(input, 'Asia/Shanghai', immediately);
  assert.equal(item.origin, 'manual');
  assert.equal(item.site, 'example.com');
  assert.equal(item.day, '2026-10-27');
  assert.equal(daily.feed.addManual(input, 'Asia/Shanghai', immediately).id, item.id);
  assert.equal(daily.feed.newToday('Asia/Shanghai'), 1);
});

test('adding interest creates feed source with group key interest:<source>; disabling sets off', () => {
  const { source } = daily.interests.add({ label: 'AI agent' });
  assert.equal(source.kind, 'interest');
  assert.equal(source.concernId, `interest:${source.id}`);
  assert.equal(source.level, 'more');
  const off = daily.interests.setLevel(source.id, source.version, 'off');
  assert.equal(off.level, 'off');
});

test('DST transition days align to local midnight (23h spring, 25h fall) for any timestamp that day', () => {
  const spring = dayRange('2026-03-08', 'America/New_York');
  assert.equal(spring.start.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(spring.end.toISOString(), '2026-03-09T04:00:00.000Z');
  const fall = dayRange('2026-11-01', 'America/New_York');
  assert.equal(fall.start.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(fall.end.toISOString(), '2026-11-02T05:00:00.000Z');
  const springNoon = localDayStart(new Date('2026-03-08T20:00:00.000Z'), 'America/New_York');
  assert.equal(springNoon.toISOString(), spring.start.toISOString());
  const fallNight = localDayStart(new Date('2026-11-01T23:30:00.000Z'), 'America/New_York');
  assert.equal(fallNight.toISOString(), fall.start.toISOString());
  assert.equal(dayStartOf('2026-10-28', 'Asia/Shanghai').toISOString(), '2026-10-27T16:00:00.000Z');
});

for (const sample of [
  { zone: 'America/Santiago', day: '2026-09-06', start: '2026-09-06T04:00:00.000Z', hours: 23 },
  { zone: 'America/Havana', day: '2026-03-08', start: '2026-03-08T05:00:00.000Z', hours: 23 },
  { zone: 'America/Havana', day: '2026-11-01', start: '2026-11-01T04:00:00.000Z', hours: 25 },
]) {
  test(`${sample.zone} ${sample.day} skipped or repeated midnight: picks first existing instant`, () => {
    const range = dayRange(sample.day, sample.zone);
    assert.equal(range.start.toISOString(), sample.start);
    assert.equal(range.end.getTime() - range.start.getTime(), sample.hours * 60 * 60 * 1000);
    assert.equal(localDay(range.start, sample.zone), sample.day);
    assert.notEqual(localDay(new Date(range.start.getTime() - 1), sample.zone), sample.day);
    assert.equal(localDay(new Date(range.end.getTime() - 1), sample.zone), sample.day);
    assert.notEqual(localDay(range.end, sample.zone), sample.day);
    const later = new Date(range.start.getTime() + 2 * 60 * 60 * 1000);
    assert.equal(localDayStart(later, sample.zone).toISOString(), sample.start);
  });
}

test('normalizes credential param names for substring match while keeping keyword and page', () => {
  const query = 'accessToken=1&client_secret=2&X-Api-Key=3&id_token=4&signature=5&keyword=ai&page=2';
  const raw = `https://example.com/a?${query}`;
  assert.equal(linkKey(raw), 'https://example.com/a?keyword=ai&page=2');
  assert.equal(linkKey('https://example.com/a?sessionId=9&apiKey=8&monkey=1'), 'https://example.com/a?monkey=1');
});

test('manual add stores raw URL keeping credential params, userinfo, and fragment across store/SSE', () => {
  const urls: (string | null)[] = [];
  daily.feed.attach({ itemChanged: (item) => urls.push(item.url) });
  const raws = CREDENTIAL_PARAMS.map((name) => `https://user:pass@example.com/a?${name}=abc&page=2#token=abc`);
  for (const [index, raw] of raws.entries()) {
    const item = daily.feed.addManual({ requestId: `manual-${index}`, title: '合成文章', url: raw }, 'UTC',
      immediately);
    assert.equal(item.url, raw);
    assert.equal(t.state.feedItems.require(item.id).url, item.url);
  }
  assert.deepEqual(urls, raws);
});

test('param allowlist exempts exact names only; credential suffixes, separators, encoding stripped', () => {
  const query = [
    'keyword=ai', 'monkey=1', 'passage=2', 'author=3', 'keywordToken=x', 'authorAuth=x',
    'access.token=x', 'a_u-t.hkey=x', '%61ccesstoken=x', 'bearer=x', 'jwt=x', 'otp=x', 'sid=x',
    'credential=x', 'password=x', 'passcode=x', 'authkey=x', 'authkey=y',
  ].join('&');
  assert.equal(linkKey(`https://example.com/?${query}`),
    'https://example.com/?keyword=ai&monkey=1&passage=2&author=3');
});
