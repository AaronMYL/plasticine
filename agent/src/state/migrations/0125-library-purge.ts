import type { Migration } from './migrate.ts';

/** 回收仍能还原；只有明确永久删除才清除内容并写下 purged_at。 */
export const migration: Migration = {
  id: '0125-library-purge',
  up(db) {
    for (const table of ['notes', 'spaces', 'books']) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN purged_at TEXT`);
    }
  },
};
