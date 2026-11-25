import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0066-line-archive',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN archived_at TEXT');
  },
};
