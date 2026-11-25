import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

const SCHEDULES = `CREATE TABLE schedules (${RECORD_COLUMNS},
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  ${jsonColumn('cadence', false)},
  project_id TEXT NOT NULL,
  report TEXT NOT NULL,
  place TEXT,
  ${jsonColumn('outward', true)},
  replaces_id TEXT REFERENCES schedules (id),
  drafted_by TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  line_id TEXT,
  next_at TEXT,
  last_run_at TEXT,
  last_outcome TEXT,
  last_note TEXT,
  confirm_ask_id TEXT,
  confirmed_at TEXT,
  confirmed_by_device_id TEXT,
  removed_at TEXT,
  CHECK ((confirmed_at IS NULL) = (confirmed_by_device_id IS NULL))
)`;

export const migration: Migration = {
  id: '0079-schedules',
  up(db) {
    db.exec(SCHEDULES);
    db.exec('CREATE INDEX schedules_status ON schedules (status, next_at)');
    db.exec('CREATE INDEX schedules_line ON schedules (line_id)');
  },
};
