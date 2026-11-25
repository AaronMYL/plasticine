import type { Migration } from './migrate.ts';
import { jsonColumn, RECORD_COLUMNS } from './sql.ts';

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
