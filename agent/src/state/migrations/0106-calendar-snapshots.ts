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
