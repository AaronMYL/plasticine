// 《置信度与做事方式改动方案》第一批（2026-11-04 他定合并第 1、2 批）：自迭代多记「预期」（哪个数往哪边变），
// 上线满 7 天对一次的结果记在 review。只加列：旧的自迭代两列都是 NULL，不补、不对数。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0055-self-expectations',
  up(db) {
    db.exec(`ALTER TABLE self_changes ADD COLUMN expectation TEXT
      CHECK (expectation IS NULL OR json_valid(expectation))`);
    db.exec('ALTER TABLE self_changes ADD COLUMN review TEXT CHECK (review IS NULL OR json_valid(review))');
  },
};
