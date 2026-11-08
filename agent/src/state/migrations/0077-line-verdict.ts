// 线自己说做成没有（走查 11-07：线跑完了、事没做成也打了勾）：没做成的一句原因和说的时候写到第几条。只加列，
// 旧的线两列都是空，照旧按做完显示。
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0077-line-verdict',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN unmet_reason TEXT');
    db.exec('ALTER TABLE lines ADD COLUMN verdict_seq INTEGER');
  },
};
