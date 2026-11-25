import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0125-library-purge',
  up(db) {
    for (const table of ['notes', 'spaces', 'books']) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN purged_at TEXT`);
    }
  },
};
