import type { Migration } from './migrate.ts';

// 第13批（11-14 Aaron 同意加的表和字段）：信息流条目记「在哪一处看到的」（X 的关注 / 推荐 / 书签、小红书的推荐 / 收藏，
// JSON 数组，旧条目是空的）和订阅文章的全文（一段段的 JSON，旧条目没有，再抓到时补上）。两个内置来源改名（Aaron：
// 「X 关注」改「X」，「按关注点的新闻」改「兴趣」），他没改过名的才改。
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
