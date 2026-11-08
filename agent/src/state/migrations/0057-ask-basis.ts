// 《置信度与做事方式改动方案》第 5 批「做还是问统一成一条线」：卡上记为什么问（推出来的 / 有几种可能 / 资料里没有 /
// 硬线），度量里出卡数按它分开数。只加列：上线前的旧卡都是 NULL，不倒推、不补。

import type { Migration } from './migrate.ts';
import { inList } from './sql.ts';

const BASES = ['inferred', 'options', 'missing', 'hard_line'];

export const migration: Migration = {
  id: '0057-ask-basis',
  up(db) {
    db.exec(`ALTER TABLE asks ADD COLUMN basis TEXT CHECK (basis IS NULL OR basis IN ${inList(BASES)})`);
  },
};
