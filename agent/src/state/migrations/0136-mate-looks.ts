import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0136-mate-looks',
  up(db) {
    db.exec("ALTER TABLE mates ADD COLUMN variant TEXT NOT NULL DEFAULT 'solid'");
    db.exec("ALTER TABLE mates ADD COLUMN face TEXT NOT NULL DEFAULT 'cute'");
  },
};
