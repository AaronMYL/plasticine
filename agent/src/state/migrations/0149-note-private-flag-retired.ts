import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0149-note-private-flag-retired',
  up(db) {
    db.exec('UPDATE notes SET private = 0 WHERE private = 1');
  },
};
