import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0140-feed-more-images',
  up(db) {
    db.exec("ALTER TABLE feed_items ADD COLUMN more_images TEXT NOT NULL DEFAULT '[]'");
  },
};
