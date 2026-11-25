import type { Migration } from './migrate.ts';
export const migration: Migration = {
  id: '0019-improvements',
  up(db) {
    db.exec(`CREATE TABLE improvement_control (id INTEGER PRIMARY KEY CHECK (id = 1), metadata TEXT NOT NULL);
      CREATE TABLE improvement_findings (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL);
      INSERT INTO improvement_control (id, metadata) SELECT 1, json_object(
        'version', 1, 'enabled', json('true'), 'taskCursor', COALESCE((SELECT MAX(seq) FROM task_events), 0),
        'telemetryCursor', COALESCE((SELECT MAX(rowid) FROM telemetry_events), 0), 'lastDay', NULL,
        'lastRunId', NULL, 'error', NULL, 'status', 'idle')`);
  },
};
