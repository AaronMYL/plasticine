import type { Migration } from './migrate.ts';
import { RECORD_COLUMNS } from './sql.ts';

const SENDS = `CREATE TABLE schedule_sends (${RECORD_COLUMNS},
  schedule_id TEXT NOT NULL REFERENCES schedules (id),
  confirm_ask_id TEXT NOT NULL,
  confirmed_by_device_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  run_at TEXT,
  tool_call_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  content TEXT NOT NULL,
  node_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  page_version TEXT NOT NULL,
  n INTEGER NOT NULL,
  op TEXT NOT NULL,
  page_url TEXT NOT NULL,
  UNIQUE (line_id, tool_call_id)
)`;

export const migration: Migration = {
  id: '0080-schedule-sends',
  up(db) {
    db.exec(SENDS);
    db.exec('CREATE INDEX schedule_sends_schedule ON schedule_sends (schedule_id, created_at)');
  },
};
