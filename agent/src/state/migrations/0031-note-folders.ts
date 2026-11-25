import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0031-note-folders',
  up(db) {
    db.exec(`CREATE TABLE note_folders (
      name TEXT PRIMARY KEY,
      position INTEGER NOT NULL
    )`);
  },
};
