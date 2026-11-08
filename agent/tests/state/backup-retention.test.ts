// 第 116 条：本机备份最近 7 天每份都留；更早的每周留最新一份、留 4 周；其余到期。

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

test('每天一份、连续 40 天：最近 7 天全留，更早的每周留最新一份、留 4 周，其余到期', () => {
  // 2026-09-26（周六）到 2026-11-04（周三）
  const rows = daily('2026-09-26T00:30:00.000Z', 40);
  const expired = new Set(expiredBackups(rows, '2026-11-04T12:00:00.000Z'));
  const kept = rows.map((row) => row.id).filter((id) => !expired.has(id));
  assert.deepEqual(kept, [
    '2026-10-11', '2026-10-18', '2026-10-25',
    '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
  ]);
});

test('已经清过的不再算；只有几天的备份一份都不清', () => {
  const rows = daily('2026-11-01T00:30:00.000Z', 4);
  assert.deepEqual(expiredBackups(rows, '2026-11-04T12:00:00.000Z'), []);
  const old = { id: 'old', createdAt: '2026-09-01T00:00:00.000Z', status: 'expired' };
  assert.deepEqual(expiredBackups([old], '2026-11-04T12:00:00.000Z'), []);
});
