// 「昨晚整理了什么」（《优化清单》第 10、16 条，11-06 定）：一次整理 = 一组变更。这一批只建表和读取接口；整理逻辑是后面一批。
// - memory_dreams：一次整理（开始、做完、读了几条线 / 几段对话）。
// - memory_dream_changes：一条变更——新加 / 替换（旧 → 新，带出处）/ 拿不准（两个候选）/ 走不通的路；每条可撤销。

import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

const DREAMS = `CREATE TABLE memory_dreams (${RECORD_COLUMNS},
  started_at TEXT NOT NULL,
  finished_at TEXT,
  lines_read INTEGER NOT NULL CHECK (lines_read >= 0),
  conversations_read INTEGER NOT NULL CHECK (conversations_read >= 0)
)`;

const CHANGES = `CREATE TABLE memory_dream_changes (${RECORD_COLUMNS},
  dream_id TEXT NOT NULL REFERENCES memory_dreams (id),
  kind TEXT NOT NULL,
  doc_id TEXT,
  line_id TEXT,
  old_line_id TEXT,
  text TEXT NOT NULL,
  previous TEXT,
  ${jsonColumn('candidates', false)},
  ${jsonColumn('anchors', false)},
  position INTEGER NOT NULL CHECK (position >= 0),
  undone_at TEXT,
  chosen INTEGER CHECK (chosen IS NULL OR chosen IN (0, 1)),
  resolved_at TEXT
)`;

export const migration: Migration = {
  id: '0072-memory-dreams',
  up(db) {
    db.exec(DREAMS);
    db.exec(CHANGES);
    db.exec('CREATE INDEX memory_dreams_finished ON memory_dreams (finished_at)');
    db.exec('CREATE INDEX memory_dream_changes_dream ON memory_dream_changes (dream_id, position)');
  },
};
