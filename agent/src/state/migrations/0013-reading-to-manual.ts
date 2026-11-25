import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0013-reading-to-manual',
  up(db) {
    db.exec("UPDATE feed_sources SET kind = 'internal' WHERE kind = 'reading'");
    db.exec("UPDATE feed_items SET origin = 'manual' WHERE origin = 'reading'");
  },
};
