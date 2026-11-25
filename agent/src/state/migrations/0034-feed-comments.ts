import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0034-feed-comments',
  up(db) {
    db.exec(`CREATE TABLE feed_comments (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES feed_items(id),
      author TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL,
      reply_to TEXT REFERENCES feed_comments(id), status TEXT NOT NULL, error TEXT,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX feed_comments_item ON feed_comments(item_id, created_at)`);
  },
};
