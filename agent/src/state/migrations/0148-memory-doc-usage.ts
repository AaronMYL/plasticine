import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0148-memory-doc-usage',
  up(db) {
    db.exec(`ALTER TABLE memory_docs ADD COLUMN sites TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sites))`);
    db.exec('ALTER TABLE memory_docs ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0)');
    db.exec('ALTER TABLE memory_docs ADD COLUMN last_used_at TEXT');
  },
};
