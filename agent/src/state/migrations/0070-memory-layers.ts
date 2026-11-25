import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0070-memory-layers',
  up(db) {
    db.exec('ALTER TABLE memory_doc_lines ADD COLUMN archived_at TEXT');
    db.exec('ALTER TABLE memory_doc_lines ADD COLUMN deleted_at TEXT');
    db.exec(`UPDATE memory_doc_lines SET deleted_at = retired_at
      WHERE retired_at IS NOT NULL AND retired_reason = 'forgotten'`);
    db.exec(`UPDATE memory_doc_lines SET archived_at = retired_at
      WHERE retired_at IS NOT NULL AND retired_reason != 'forgotten'`);
    db.exec('CREATE INDEX memory_doc_lines_archive ON memory_doc_lines (archived_at, deleted_at)');
  },
};
