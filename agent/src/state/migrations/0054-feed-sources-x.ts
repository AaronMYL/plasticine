import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0054-feed-sources-x',
  up(db) {
    db.exec('ALTER TABLE feed_items ADD COLUMN author TEXT');
    db.exec('ALTER TABLE feed_items ADD COLUMN author_handle TEXT');
    db.exec('ALTER TABLE feed_items ADD COLUMN avatar_url TEXT');
    db.exec('ALTER TABLE feed_items ADD COLUMN image_url TEXT');
    db.exec('ALTER TABLE feed_items ADD COLUMN image_ratio REAL');
    db.exec(`CREATE TABLE feed_source_status (
      source_id TEXT PRIMARY KEY REFERENCES feed_sources (id),
      checked_at TEXT NOT NULL,
      ok_at TEXT,
      error TEXT,
      added INTEGER NOT NULL DEFAULT 0
    )`);
  },
};
