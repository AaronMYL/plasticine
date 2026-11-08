// 定时的钟点（《优化清单》第 3 条，11-07 定：按他设备当前的时区算；错过的「下次到点照常，补跑最近一次」）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cadenceLabel, latestDue, nextRun, zonedClock } from '../../src/tasks/cadence.ts';

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
