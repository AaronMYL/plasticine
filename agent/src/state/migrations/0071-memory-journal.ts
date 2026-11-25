import type { Migration } from './migrate.ts';
import { jsonColumn } from './sql.ts';

const JOURNAL = `CREATE TABLE memory_journal (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  ${jsonColumn('anchors', false)},
  doc_id TEXT,
  line_id TEXT,
  written_by TEXT NOT NULL,
  written_ref TEXT,
  dream_id TEXT,
  archived_at TEXT,
  deleted_at TEXT,
  CHECK ((archived_at IS NULL) = (dream_id IS NULL))
)`;

export const migration: Migration = {
  id: '0071-memory-journal',
  up(db) {
    db.exec(JOURNAL);
    db.exec('CREATE INDEX memory_journal_open ON memory_journal (archived_at, deleted_at, created_at)');
  },
};
