import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0138-feed-places-body',
  up(db) {
    db.exec("ALTER TABLE feed_items ADD COLUMN places TEXT NOT NULL DEFAULT '[]'");
    db.exec('ALTER TABLE feed_items ADD COLUMN body TEXT');
    const now = String(db.all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")[0]?.['now']);
    const rename = (ref: string, from: string, to: string): void => {
      db.run(`UPDATE feed_sources SET label = $to, version = version + 1, updated_at = $now
        WHERE ref = $ref AND label = $from`, { ref, from, to, now });
    };
    rename('x:following', 'X · 你关注的人', 'X');
    rename('internal:news', '按关注点搜新闻', '兴趣');
  },
};
