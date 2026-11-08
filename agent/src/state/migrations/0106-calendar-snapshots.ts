// Apple 日历和提醒事项的缓存（《优化清单》第 15 条，用户 11-06 定）：Mac 在线时定期拉今天和接下来 7 天的日程、
// 未完成的提醒，每台 Mac 每种（events / reminders）一行，新的一份整份换掉旧的；Mac 不在线时首页和心跳读它。
import type { Migration } from './migrate.ts';

const SNAPSHOTS = `CREATE TABLE calendar_snapshots (
  node_id TEXT NOT NULL REFERENCES nodes (id),
  scope TEXT NOT NULL CHECK (scope IN ('events', 'reminders')),
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  items TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (node_id, scope)
)`;

export const migration: Migration = {
  id: '0106-calendar-snapshots',
  up(db) {
    db.exec(SNAPSHOTS);
    db.exec('CREATE INDEX calendar_snapshots_synced ON calendar_snapshots (scope, synced_at)');
  },
};
