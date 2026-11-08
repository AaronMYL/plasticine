// 信息流来源能删（第 7 批第 10 条，他定）：删一个订阅 / Reddit 版块不删行——条目、评论、译文都挂在来源上——只记下删的
// 时间。删了的来源不再列、不再抓；它没收藏过的条目从信息流里拿掉，收藏过的留在「收藏」里。再加同一个地址就把它找回来。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0113-feed-source-removed',
  up(db) {
    db.exec('ALTER TABLE feed_sources ADD COLUMN removed_at TEXT');
  },
};
