// 旧约定的改动历史也删掉（11-16 Aaron：0141 删表以后 Claude 说 versions 里还留着旧约定每一版的原文，他回「删」）。
// 只删 object_type 是 agreement 的行；别的退役对象（关切、判断、证据、来源、任务）的历史不在这次同意的范围里，不动。
// 删的时候用零覆盖（secure_delete），原文不留在这几页里。线上删之前这些行先导出留底 7 天。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0142-drop-agreement-history',
  destructive: true,
  changes: ['versions'],
  up(db) {
    db.exec('PRAGMA secure_delete = ON');
    try {
      db.exec("DELETE FROM versions WHERE object_type = 'agreement'");
    } finally {
      db.exec('PRAGMA secure_delete = OFF');
    }
  },
};
