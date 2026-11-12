// 定时的钟点（《优化清单》第 3 条，11-07 定：按他设备当前的时区算；错过的「下次到点照常，补跑最近一次」）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cadenceLabel, coveredBy, latestDue, missedDue, nextAfterRun, nextRun, rezonedNext, zonedClock }
  from '../../src/tasks/cadence.ts';

const SHANGHAI = 'Asia/Shanghai';

test('每天 15:00：还没到就是今天，过了就是明天；按所给的时区算', () => {
  const daily = { type: 'daily' as const, at: '15:00' };
  assert.equal(nextRun(daily, new Date('2026-11-07T06:00:00Z'), SHANGHAI).toISOString(), '2026-11-07T07:00:00.000Z');
  assert.equal(nextRun(daily, new Date('2026-11-07T07:00:00Z'), SHANGHAI).toISOString(), '2026-11-08T07:00:00.000Z');
  // 出差到东京：同一个 15:00 早一个钟头到。
  assert.equal(nextRun(daily, new Date('2026-11-07T05:00:00Z'), 'Asia/Tokyo').toISOString(),
    '2026-11-07T06:00:00.000Z');
});

test('每周一 09:00：跳到下一个周一；工作日只挑周一到周五', () => {
  const monday = { type: 'weekly' as const, days: [1], at: '09:00' };
  // 2026-11-07 是周六。
  assert.equal(nextRun(monday, new Date('2026-11-07T00:00:00Z'), SHANGHAI).toISOString(), '2026-11-09T01:00:00.000Z');
  const workdays = { type: 'weekly' as const, days: [1, 2, 3, 4, 5], at: '09:00' };
  assert.equal(nextRun(workdays, new Date('2026-11-09T02:00:00Z'), SHANGHAI).toISOString(),
    '2026-11-10T01:00:00.000Z');
});

test('每隔 N 分钟：从给的时刻往后数', () => {
  const every = { type: 'interval' as const, minutes: 30 };
  assert.equal(nextRun(every, new Date('2026-11-07T00:10:00Z'), SHANGHAI).toISOString(), '2026-11-07T00:40:00.000Z');
});

test('夏令时那天的钟点照本地时间算', () => {
  // 2026-03-08 纽约拨快一小时：09:00 是 EDT（UTC-4）。
  const daily = { type: 'daily' as const, at: '09:00' };
  assert.equal(nextRun(daily, new Date('2026-03-08T05:00:00Z'), 'America/New_York').toISOString(),
    '2026-03-08T13:00:00.000Z');
  assert.equal(zonedClock('2026-03-07', '09:00', 'America/New_York').toISOString(), '2026-03-07T14:00:00.000Z');
});

test('错过了几次：只补最近的那一次', () => {
  const daily = { type: 'daily' as const, at: '15:00' };
  // 关机三天：11-04 15:00 该跑，11-07 18:00 才开机。补的是 11-07 15:00 那一次。
  const due = latestDue(daily, new Date('2026-11-04T07:00:00Z'), new Date('2026-11-07T10:00:00Z'), SHANGHAI);
  assert.equal(due.toISOString(), '2026-11-07T07:00:00.000Z');
  // 刚好到点：就是这一次。
  assert.equal(latestDue(daily, new Date('2026-11-07T07:00:00Z'), new Date('2026-11-07T07:00:30Z'), SHANGHAI)
    .toISOString(), '2026-11-07T07:00:00.000Z');
});

test('卡上那一句：每天、每周几、工作日、每隔几分钟', () => {
  assert.equal(cadenceLabel({ type: 'daily', at: '15:00' }), '每天 15:00');
  assert.equal(cadenceLabel({ type: 'weekly', days: [1], at: '09:00' }), '周一 09:00');
  assert.equal(cadenceLabel({ type: 'weekly', days: [3, 1], at: '09:00' }), '周一、三 09:00');
  assert.equal(cadenceLabel({ type: 'weekly', days: [1, 2, 3, 4, 5], at: '09:00' }), '工作日 09:00');
  assert.equal(cadenceLabel({ type: 'weekly', days: [7], at: '21:00' }), '周日 21:00');
  assert.equal(cadenceLabel({ type: 'interval', minutes: 30 }), '每 30 分钟');
  assert.equal(cadenceLabel({ type: 'interval', minutes: 120 }), '每 2 小时');
});

const CHICAGO = 'America/Chicago';
const DAILY_8 = { type: 'daily' as const, at: '08:00' };

test('换时区重排（11-12 漏发）：旧的更早还没到就留着旧的，不会被推到明天', () => {
  // 北京 08:00 = 00:00Z；23:30Z 时被切到芝加哥：芝加哥 08:00 是 14:00Z，旧的 00:00Z 更早，留着。
  const previous = new Date('2026-11-12T00:00:00Z');
  const toChicago = rezonedNext(DAILY_8, previous, new Date('2026-11-11T23:30:00Z'), CHICAGO,
    new Date('2026-11-11T00:00:00Z'));
  assert.equal(toChicago.toISOString(), '2026-11-12T00:00:00.000Z');
  // 又切回北京：照北京算的就是这个，不变。
  assert.equal(rezonedNext(DAILY_8, toChicago, new Date('2026-11-11T23:40:00Z'), SHANGHAI,
    new Date('2026-11-11T00:00:00Z')).toISOString(), '2026-11-12T00:00:00.000Z');
});

test('换时区重排：新时区里和上次出的是同一天，往后挪一期，不重复出', () => {
  // 北京 08:00（00:00Z）出过；切到东京：东京当天 08:00（23:00Z 前一天）已过，下一个是明天，和上次不是同一天，照常。
  assert.equal(rezonedNext(DAILY_8, new Date('2026-11-13T00:00:00Z'), new Date('2026-11-12T01:00:00Z'), 'Asia/Tokyo',
    new Date('2026-11-12T00:00:00Z')).toISOString(), '2026-11-12T23:00:00.000Z');
  // 出完那一刻排下一次：按北京算，明天 08:00；同一天的不再排。
  assert.equal(nextAfterRun(DAILY_8, new Date('2026-11-12T00:00:00Z'), new Date('2026-11-12T00:01:00Z'), SHANGHAI)
    .toISOString(), '2026-11-13T00:00:00.000Z');
  // 芝加哥 08:00（14:00Z）出过，刚过午夜切回北京：北京今天 08:00（16:00Z 后的 00:00Z）是北京的 11-13，新的一天，照常出。
  assert.equal(rezonedNext(DAILY_8, new Date('2026-11-13T14:00:00Z'), new Date('2026-11-12T16:30:00Z'), SHANGHAI,
    new Date('2026-11-12T14:00:00Z')).toISOString(), '2026-11-13T00:00:00.000Z');
  // 北京 00:00Z 出过，同一北京日里又排北京时间：同一天跳过。
  assert.equal(nextAfterRun(DAILY_8, new Date('2026-11-12T00:00:00Z'), new Date('2026-11-11T23:59:00Z'), SHANGHAI)
    .toISOString(), '2026-11-13T00:00:00.000Z');
});

test('查漏发：往回一天里本该出、过了宽限的那一刻；出过（差几个小时也算）就不算漏', () => {
  const hour = 60 * 60_000;
  const due = missedDue(DAILY_8, new Date('2026-11-12T05:00:00Z'), SHANGHAI, hour);
  assert.equal(due?.toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(missedDue(DAILY_8, new Date('2026-11-12T00:30:00Z'), SHANGHAI, hour)?.toISOString(),
    '2026-11-11T00:00:00.000Z');
  assert.equal(missedDue({ type: 'interval', minutes: 30 }, new Date(), SHANGHAI, hour), null);
  assert.equal(coveredBy(new Date('2026-11-10T14:00:00Z'), new Date('2026-11-12T00:00:00Z')), false);
  assert.equal(coveredBy(new Date('2026-11-11T14:00:00Z'), new Date('2026-11-12T00:00:00Z')), true);
  assert.equal(coveredBy(null, new Date('2026-11-12T00:00:00Z')), false);
});

