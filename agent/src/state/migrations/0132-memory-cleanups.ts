import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

export const migration: Migration = {
  id: '0132-memory-cleanups',
  up(db) {
    db.exec(`CREATE TABLE memory_cleanups (${RECORD_COLUMNS},
      status TEXT NOT NULL,
      error TEXT,
      overview TEXT,
      ${jsonColumn('items', false)},
      finished_at TEXT)`);
    db.exec('CREATE INDEX memory_cleanups_created ON memory_cleanups(created_at)');
  },
};
