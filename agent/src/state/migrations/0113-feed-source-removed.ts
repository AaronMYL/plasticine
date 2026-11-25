import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0113-feed-source-removed',
  up(db) {
    db.exec('ALTER TABLE feed_sources ADD COLUMN removed_at TEXT');
  },
};
