import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0026-feed-search',
  up(db) {
    db.exec('ALTER TABLE feed_sources ADD COLUMN query_edited INTEGER NOT NULL DEFAULT 0');
    db.exec(`CREATE TABLE feed_refresh_runs (
      request_id TEXT PRIMARY KEY, day TEXT NOT NULL, status TEXT NOT NULL,
      started_at TEXT, finished_at TEXT, added INTEGER NOT NULL DEFAULT 0, error TEXT
    )`);
    db.exec('CREATE INDEX feed_items_url ON feed_items (url)');
  },
};
