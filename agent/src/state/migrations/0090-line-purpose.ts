import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0090-line-purpose',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN model_purpose TEXT');
  },
};
