import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

// 记忆的全量整理（11-11 Aaron 同意）：一次整理一行，清单（items）和总览存在这一行里；Aaron 勾选后逐条采用。
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
