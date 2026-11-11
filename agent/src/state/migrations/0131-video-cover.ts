import type { Migration } from './migrate.ts';

// 第 11 批（11-11 Aaron 同意加封面）：抖音收藏列表显示封面。同步收藏时记下抖音给的封面地址，旧作品下次同步补上。
export const migration: Migration = {
  id: '0131-video-cover',
  up(db) {
    db.exec('ALTER TABLE video_works ADD COLUMN cover_url TEXT');
  },
};
