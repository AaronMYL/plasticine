import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

// 第 11 批第二步（11-11 Aaron 同意）：记忆每一行带适用范围（全部 / 某位队友 / 某个项目 / 某个联系人），旧行都是「全部」；
// 说法冲突单独一张表：每晚整理时找出来，Aaron 选以哪条为准。范围、状态只用 shared 的 schema 检查，不写 CHECK 列表。
export const migration: Migration = {
  id: '0130-memory-scope',
  up(db) {
    db.exec("ALTER TABLE memory_doc_lines ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'all'");
    db.exec('ALTER TABLE memory_doc_lines ADD COLUMN scope_ref TEXT');
    db.exec('CREATE INDEX memory_doc_lines_scope ON memory_doc_lines(scope_kind, scope_ref)');
    db.exec(`CREATE TABLE memory_conflicts (${RECORD_COLUMNS},
      title TEXT NOT NULL,
      ${jsonColumn('line_ids', false)},
      status TEXT NOT NULL,
      resolution TEXT,
      ${jsonColumn('kept_line_ids', false)},
      found_by TEXT,
      resolved_at TEXT,
      CHECK ((status = 'open') = (resolved_at IS NULL)))`);
    db.exec('CREATE INDEX memory_conflicts_status ON memory_conflicts(status, created_at)');
  },
};
