// 「今天的记录」（《优化清单》第 10 条白天部分，11-06 定）：每轮对话后追加的带出处短记录，只追加。
// 夜里整理完挪进归档（archived_at + dream_id），30 天后记删除（deleted_at）；行不物理删。种类只用 shared 的 schema 检查。

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
