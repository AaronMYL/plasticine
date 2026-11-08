import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  cleanUrl,
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

// 10-27 16:30 in Shanghai, just after the state clock of the test library (10-27 08:00 UTC, a second per write).
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

test('链接先校验：用户名密码去掉，不是 http(s) 的拒收；像凭据的参数和片段去掉，别的参数留着', () => {
  assert.equal(cleanUrl('https://me:secret@example.com/a'), 'https://example.com/a');
  assert.throws(() => cleanUrl('javascript:alert(1)'), DailyError);
  assert.throws(() => cleanUrl('不是网址 token=abc'), (error: unknown) => {
    return error instanceof DailyError && !error.message.includes('token=abc');
  });
  const cleaned = cleanUrl('https://example.com/p?id=7&access_token=abc&X-Amz-Signature=s&keyword=ai#top');
  assert.equal(cleaned, 'https://example.com/p?id=7&keyword=ai');
});

test('今天按用户时区算：上海 10-27 16:30 是 10-27，这天从 UTC 10-26 16:00 开始', () => {
  assert.equal(localDay(NOW, 'Asia/Shanghai'), '2026-10-27');
  assert.equal(localDayStart(NOW, 'Asia/Shanghai').toISOString(), '2026-10-26T16:00:00.000Z');
});

test('今天新的按完整的本地日区间计数，不包含明天和更远的条目', () => {
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

test('手动添加信息流条目：同一个请求只加一条', () => {
  const url = 'https://example.com/a';
  const input = { requestId: 'req-00000001', title: '一篇讲 agent 的文章', url };
  const item = daily.feed.addManual(input, 'Asia/Shanghai', immediately);
  assert.equal(item.origin, 'manual');
  assert.equal(item.site, 'example.com');
  assert.equal(item.day, '2026-10-27');
  assert.equal(daily.feed.addManual(input, 'Asia/Shanghai', immediately).id, item.id);
  assert.equal(daily.feed.newToday('Asia/Shanghai'), 1);
});

test('关注点：加一个就是一条「多看」的兴趣来源，分组键是 interest:<来源>（2026-11-05 起不再开关切），关掉只置 off', () => {
  const { source } = daily.interests.add({ label: 'AI agent' });
  assert.equal(source.kind, 'interest');
  assert.equal(source.concernId, `interest:${source.id}`);
  assert.equal(source.level, 'more');
  const off = daily.interests.setLevel(source.id, source.version, 'off');
  assert.equal(off.level, 'off');
});

test('夏令时切换日按当地午夜算：纽约 3 月 8 日只有 23 小时、11 月 1 日有 25 小时；当天任一时刻都落回当地午夜', () => {
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
  test(`${sample.zone} ${sample.day} 午夜跳过或重复：取当天第一个存在的时刻`, () => {
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

test('凭据参数名归一后按子串认，keyword、page 留着', () => {
  const query = 'accessToken=1&client_secret=2&X-Api-Key=3&id_token=4&signature=5&keyword=ai&page=2';
  const raw = `https://example.com/a?${query}`;
  assert.equal(cleanUrl(raw), 'https://example.com/a?keyword=ai&page=2');
  assert.equal(cleanUrl('https://example.com/a?sessionId=9&apiKey=8&monkey=1'), 'https://example.com/a?monkey=1');
});

test('手动添加统一清洗连写凭据、userinfo 和片段，存储与事件一致', () => {
  const urls: (string | null)[] = [];
  daily.feed.attach({ itemChanged: (item) => urls.push(item.url) });
  for (const name of CREDENTIAL_PARAMS) {
    const item = daily.feed.addManual({
      requestId: `manual-${name}`, title: '合成文章',
      url: `https://user:pass@example.com/a?${name}=abc&page=2#token=abc`,
    }, 'UTC', immediately);
    assert.equal(item.url, 'https://example.com/a?page=2');
    assert.equal(t.state.feedItems.require(item.id).url, item.url);
  }
  assert.deepEqual(urls, CREDENTIAL_PARAMS.map(() => 'https://example.com/a?page=2'));
});

test('参数白名单只豁免完整名称，带凭据后缀仍删除，分隔符和编码都不能绕过', () => {
  const query = [
    'keyword=ai', 'monkey=1', 'passage=2', 'author=3', 'keywordToken=x', 'authorAuth=x',
    'access.token=x', 'a_u-t.hkey=x', '%61ccesstoken=x', 'bearer=x', 'jwt=x', 'otp=x', 'sid=x',
    'credential=x', 'password=x', 'passcode=x', 'authkey=x', 'authkey=y',
  ].join('&');
  assert.equal(cleanUrl(`https://example.com/?${query}`),
    'https://example.com/?keyword=ai&monkey=1&passage=2&author=3');
});
