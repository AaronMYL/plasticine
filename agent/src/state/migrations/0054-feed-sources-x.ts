// 第 3 批信息流（用户 11-04 定）：来源是 RSS / 博客订阅 + X 上他关注的人 + 按关注点搜的新闻；形态是瀑布流卡片。
// 只加不改：
// 1. 条目加作者、头像、配图和配图宽高比（X 的帖子和带图的文章；原图网址存库，给界面时换成服务端代理地址）；
// 2. 每个来源最近一次抓 / 读的结果单独一张表（不改来源行的 version：设置里开关来源时不会因为抓取撞版本），
//    设置里那一行据它写「上次没抓到：原因」。

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
