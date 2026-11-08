// 第 94 条取消阅读后，已在新版库中的试写数据仍需可读；只换类别，原内容、ID、关联和历史保持不变。
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0013-reading-to-manual',
  up(db) {
    db.exec("UPDATE feed_sources SET kind = 'internal' WHERE kind = 'reading'");
    db.exec("UPDATE feed_items SET origin = 'manual' WHERE origin = 'reading'");
  },
};
