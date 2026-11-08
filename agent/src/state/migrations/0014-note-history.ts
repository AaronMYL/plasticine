import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0014-note-history',
  up(db) {
    db.exec('ALTER TABLE note_versions ADD COLUMN restored_from_version INTEGER');
    // 只登记仍有原件的当前版，不推造迁移前或已经丢失的中间历史。
    db.exec(`INSERT OR IGNORE INTO note_versions
      (note_id, version, body_file, body_bytes, body_sha256, author, saved_at)
      SELECT id, version, body_file, body_bytes, body_sha256, author, updated_at FROM notes`);
  },
};
