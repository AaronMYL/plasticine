import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cadenceLabel, coveredBy, latestDue, missedDue, nextAfterRun, nextRun, rezonedNext, zonedClock }
  from '../../src/tasks/cadence.ts';

const SHANGHAI = 'Asia/Shanghai';

test('Daily 15:00 picks today if before or tomorrow if past in the given timezone', () => {
  const daily = { type: 'daily' as const, at: '15:00' };
  assert.equal(nextRun(daily, new Date('2026-11-07T06:00:00Z'), SHANGHAI).toISOString(), '2026-11-07T07:00:00.000Z');
  assert.equal(nextRun(daily, new Date('2026-11-07T07:00:00Z'), SHANGHAI).toISOString(), '2026-11-08T07:00:00.000Z');
  assert.equal(nextRun(daily, new Date('2026-11-07T05:00:00Z'), 'Asia/Tokyo').toISOString(),
    '2026-11-07T06:00:00.000Z');
});

test('Weekly Mon 09:00 jumps to next Monday; weekdays pick Mon-Fri only', () => {
  const monday = { type: 'weekly' as const, days: [1], at: '09:00' };
  assert.equal(nextRun(monday, new Date('2026-11-07T00:00:00Z'), SHANGHAI).toISOString(), '2026-11-09T01:00:00.000Z');
  const workdays = { type: 'weekly' as const, days: [1, 2, 3, 4, 5], at: '09:00' };
  assert.equal(nextRun(workdays, new Date('2026-11-09T02:00:00Z'), SHANGHAI).toISOString(),
    '2026-11-10T01:00:00.000Z');
});

test('Every N minutes counts forward from the given timestamp', () => {
  const every = { type: 'interval' as const, minutes: 30 };
  assert.equal(nextRun(every, new Date('2026-11-07T00:10:00Z'), SHANGHAI).toISOString(), '2026-11-07T00:40:00.000Z');
});

test('Clock time on DST transition day calculates in local wall-clock time', () => {
  const daily = { type: 'daily' as const, at: '09:00' };
  assert.equal(nextRun(daily, new Date('2026-03-08T05:00:00Z'), 'America/New_York').toISOString(),
    '2026-03-08T13:00:00.000Z');
  assert.equal(zonedClock('2026-03-07', '09:00', 'America/New_York').toISOString(), '2026-03-07T14:00:00.000Z');
});

test('Multiple missed runs catch up only the most recent occurrence', () => {
  const daily = { type: 'daily' as const, at: '15:00' };
  const due = latestDue(daily, new Date('2026-11-04T07:00:00Z'), new Date('2026-11-07T10:00:00Z'), SHANGHAI);
  assert.equal(due.toISOString(), '2026-11-07T07:00:00.000Z');
  assert.equal(latestDue(daily, new Date('2026-11-07T07:00:00Z'), new Date('2026-11-07T07:00:30Z'), SHANGHAI)
    .toISOString(), '2026-11-07T07:00:00.000Z');
});

test('Formats card schedule label for daily, weekly, weekdays, and every N minutes', () => {
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

test('Timezone change keeps earlier unreached next run instead of pushing to tomorrow', () => {
  const previous = new Date('2026-11-12T00:00:00Z');
  const toChicago = rezonedNext(DAILY_8, previous, new Date('2026-11-11T23:30:00Z'), CHICAGO,
    new Date('2026-11-11T00:00:00Z'));
  assert.equal(toChicago.toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(rezonedNext(DAILY_8, toChicago, new Date('2026-11-11T23:40:00Z'), SHANGHAI,
    new Date('2026-11-11T00:00:00Z')).toISOString(), '2026-11-12T00:00:00.000Z');
});

test('Timezone change advances one period if new zone shares last run\'s calendar day', () => {
  assert.equal(rezonedNext(DAILY_8, new Date('2026-11-13T00:00:00Z'), new Date('2026-11-12T01:00:00Z'), 'Asia/Tokyo',
    new Date('2026-11-12T00:00:00Z')).toISOString(), '2026-11-12T23:00:00.000Z');
  assert.equal(nextAfterRun(DAILY_8, new Date('2026-11-12T00:00:00Z'), new Date('2026-11-12T00:01:00Z'), SHANGHAI)
    .toISOString(), '2026-11-13T00:00:00.000Z');
  assert.equal(rezonedNext(DAILY_8, new Date('2026-11-13T14:00:00Z'), new Date('2026-11-12T16:30:00Z'), SHANGHAI,
    new Date('2026-11-12T14:00:00Z')).toISOString(), '2026-11-13T00:00:00.000Z');
  assert.equal(nextAfterRun(DAILY_8, new Date('2026-11-12T00:00:00Z'), new Date('2026-11-11T23:59:00Z'), SHANGHAI)
    .toISOString(), '2026-11-13T00:00:00.000Z');
});

test('Missed check finds due slot past grace within 24h; nearby prior run counts sent', () => {
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

