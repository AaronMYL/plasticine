// 早就退役的对象的改动历史也删掉（11-16 Aaron：「删……该删的就删了，不要再次确认」）。
// 任务、来源、关切、判断、证据的表 11-05 的 0062 就删了，versions 里它们每一版的快照一直留着，没有任何地方再读。
// 现在还在用的对象（旧记忆条目 memory_entry）的历史不动。删的时候用零覆盖（secure_delete）。
// 线上删之前这些行先导出留底 7 天。

import type { Migration } from './migrate.ts';

const RETIRED = ['task', 'source', 'concern', 'judgment', 'evidence'] as const;

export const migration: Migration = {
  id: '0143-drop-retired-history',
  destructive: true,
  changes: ['versions'],
  up(db) {
    db.exec('PRAGMA secure_delete = ON');
    try {
      db.exec(`DELETE FROM versions WHERE object_type IN (${RETIRED.map((type) => `'${type}'`).join(', ')})`);
    } finally {
      db.exec('PRAGMA secure_delete = OFF');
    }
  },
};
