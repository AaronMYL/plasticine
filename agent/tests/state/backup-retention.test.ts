import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expiredBackups } from '../../src/state/backup-retention.ts';

function daily(from: string, days: number) {
  const start = Date.parse(from);
  return Array.from({ length: days }, (_, index) => {
    const at = new Date(start + index * 24 * 60 * 60 * 1000).toISOString();
    return { id: at.slice(0, 10), createdAt: at, status: 'ready' };
  });
}

test('Daily backups over 40 consecutive days retain only the latest 2 snapshots', () => {
  const rows = daily('2026-09-26T00:30:00.000Z', 40);
  const expired = new Set(expiredBackups(rows, '2026-11-04T12:00:00.000Z'));
  assert.deepEqual(rows.map((row) => row.id).filter((id) => !expired.has(id)), ['2026-11-03', '2026-11-04']);
});

test('Two backups with no newer ones still prune after 7 days instead of staying', () => {
  const rows = daily('2026-11-01T00:30:00.000Z', 2);
  assert.deepEqual(expiredBackups(rows, '2026-11-07T12:00:00.000Z'), []);
  assert.deepEqual(expiredBackups(rows, '2026-11-08T00:30:00.000Z'), ['2026-11-01']);
  assert.deepEqual(expiredBackups(rows, '2026-11-09T00:30:00.000Z'), ['2026-11-01', '2026-11-02']);
});

test('Already-pruned backups do not count; failed backups take no slot, prune at 7d', () => {
  const old = { id: 'old', createdAt: '2026-09-01T00:00:00.000Z', status: 'expired' };
  assert.deepEqual(expiredBackups([old], '2026-11-04T12:00:00.000Z'), []);
  const rows = [...daily('2026-11-01T00:30:00.000Z', 3),
    { id: 'failed-new', createdAt: '2026-11-04T00:30:00.000Z', status: 'failed' },
    { id: 'failed-old', createdAt: '2026-10-20T00:30:00.000Z', status: 'failed' }];
  assert.deepEqual(expiredBackups(rows, '2026-11-04T12:00:00.000Z').toSorted(), ['2026-11-01', 'failed-old']);
});
