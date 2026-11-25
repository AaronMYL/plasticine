import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0044-message-widgets',
  up(db) {
    db.exec(`ALTER TABLE messages ADD COLUMN widgets TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(widgets))`);
    db.exec('ALTER TABLE messages ADD COLUMN answer_to TEXT CHECK (answer_to IS NULL OR json_valid(answer_to))');
  },
};
