import type { Migration } from './migrate.ts';

const LINE_DAYS = `CREATE TABLE line_days (
  line_id TEXT NOT NULL REFERENCES lines (id),
  day TEXT NOT NULL,
  start_seq INTEGER NOT NULL CHECK (start_seq >= 1),
  summary TEXT,
  summary_seq INTEGER NOT NULL DEFAULT 0 CHECK (summary_seq >= 0),
  compactions INTEGER NOT NULL DEFAULT 0 CHECK (compactions >= 0),
  digest TEXT,
  digest_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (line_id, day)
)`;

export const migration: Migration = {
  id: '0087-line-days',
  up(db) {
    db.exec(LINE_DAYS);
  },
};
