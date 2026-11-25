import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResearchSettings, ReviewSettings, Subscription } from '../../shared/state.ts';
import { nextRunAt, schedulesOf } from '../../src/subs/index.ts';

const SHANGHAI = 'Asia/Shanghai';

test('Weekly Mon 09:00 Shanghai computed Sat afternoon yields Mon 01:00Z', () => {
  const at = nextRunAt({ every: 'week', weekday: 1, time: '09:00' }, SHANGHAI, new Date('2026-11-07T08:00:00Z'));
  assert.equal(at.toISOString(), '2026-11-09T01:00:00.000Z');
});

test('Daily 08:00 returns today if before time and tomorrow if already past', () => {
  const daily = { every: 'day', time: '08:00' } as const;
  assert.equal(nextRunAt(daily, SHANGHAI, new Date('2026-11-06T23:00:00Z')).toISOString(), '2026-11-07T00:00:00.000Z');
  assert.equal(nextRunAt(daily, SHANGHAI, new Date('2026-11-07T00:00:00Z')).toISOString(), '2026-11-08T00:00:00.000Z');
});

test('Converts schedule accurately for user\'s local timezone (New York winter)', () => {
  const at = nextRunAt({ every: 'week', weekday: 0, time: '20:00' }, 'America/New_York',
    new Date('2026-11-07T12:00:00Z'));
  assert.equal(at.toISOString(), '2026-11-09T01:00:00.000Z');
});

function sub(settings: ResearchSettings | ReviewSettings, status: Subscription['status']): Subscription {
  const T = '2026-11-07T00:00:00.000Z';
  return { id: 's1', createdAt: T, updatedAt: T, version: 1, title: 't', kind: settings.kind, status, settings,
    timeZone: SHANGHAI, lineId: null, lastRunAt: null };
}

const REVIEW: ReviewSettings = { kind: 'review', daily: { on: true, time: '08:00' },
  weekly: { on: true, weekday: 0, time: '21:00' }, topics: [], sources: [], exclude: [], rules: [] };

test('Personal review lists daily/weekly times; omits disabled, draft, and paused', () => {
  assert.deepEqual(schedulesOf(sub(REVIEW, 'active')).map((item) => [item.edition, item.schedule.time]),
    [['daily', '08:00'], ['weekly', '21:00']]);
  assert.deepEqual(schedulesOf(sub({ ...REVIEW, daily: { on: false, time: '08:00' } }, 'active'))
    .map((item) => item.edition), ['weekly']);
  assert.deepEqual(schedulesOf(sub(REVIEW, 'paused')), []);
  assert.deepEqual(schedulesOf(sub(REVIEW, 'sample')), []);
});
