import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0023-external-feed',
  up(db) {
    db.exec(`CREATE TABLE feed_fetch_runs (
      day TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, error TEXT
    )`);
    db.exec('ALTER TABLE feed_items ADD COLUMN reaction_at TEXT');
    db.exec('UPDATE feed_items SET reaction_at = updated_at WHERE reaction IS NOT NULL');
  },
};
