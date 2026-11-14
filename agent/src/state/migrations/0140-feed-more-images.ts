import type { Migration } from './migrate.ts';

// 11-14 图片统一（Aaron 弹框选「只改 X，其余只放封面」）：信息流条目记封面以外的图（JSON 数组，按顺序，最多三张；只有 X
// 的帖子有）。旧条目是空的：以前只存了封面的帖子，再读到时补上。
export const migration: Migration = {
  id: '0140-feed-more-images',
  up(db) {
    db.exec("ALTER TABLE feed_items ADD COLUMN more_images TEXT NOT NULL DEFAULT '[]'");
  },
};
