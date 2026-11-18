// 笔记上的「私密」记号退役（11-18 用户定：「私密笔记早就没用了，这个功能也删了吧」，标着的都变成普通笔记）。
// 这个记号只让笔记不进对话、不能引用、不给工具看；对外可见四档里的「私密」是另一回事，不动。
// 只把标着的行改回 0，版本和改动时间不动（不是他改了笔记）；列留着不删，旧备份照样读得进来。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0149-note-private-flag-retired',
  up(db) {
    db.exec('UPDATE notes SET private = 0 WHERE private = 1');
  },
};
