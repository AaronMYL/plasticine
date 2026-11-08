// 旁聊和子代理的结论（《优化清单》第 17 条）。只加列：
// - lines.topic：旁聊围绕的那一条（信息流条目、主线里的一句），JSON；主线和后台线是 NULL。
// - lines.conclusion：后台线用 line_outcome 交给发起它的线的结论（说给人听的几句）；技术交接留在那条线自己里。
// 线的种类加 side 不改表：kind 没有 CHECK（0058）。

import type { Migration } from './migrate.ts';
import { jsonColumn } from './sql.ts';

export const migration: Migration = {
  id: '0088-side-lines',
  up(db) {
    db.exec(`ALTER TABLE lines ADD COLUMN ${jsonColumn('topic', true)}`);
    db.exec('ALTER TABLE lines ADD COLUMN conclusion TEXT');
  },
};
