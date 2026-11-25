import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0055-self-expectations',
  up(db) {
    db.exec(`ALTER TABLE self_changes ADD COLUMN expectation TEXT
      CHECK (expectation IS NULL OR json_valid(expectation))`);
    db.exec('ALTER TABLE self_changes ADD COLUMN review TEXT CHECK (review IS NULL OR json_valid(review))');
  },
};
