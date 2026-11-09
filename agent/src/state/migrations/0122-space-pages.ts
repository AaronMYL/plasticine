// 第 8 批第 6 条（他 11-09 定）：空间改成整页网页，两种体裁——报告（按内容自由排版）和来信（固定信纸，模型只写正文）。
// 只加不改：
// - spaces、space_revisions 加 genre（report / letter）和 html（body 里的正文片段，存之前清洗过）。旧的 doc 列留着：
//   重写成网页以前的版本还在历史里，界面在重写完成以前照旧按 doc 显示。
// - space_rewrites：旧空间按新版式重写（服务启动后的一次性后台活，要调模型，不能放进迁移）：做成了记下时间，重启不再做；
//   失败记次数和原因，下次启动再试，到上限就停。

import type { Migration } from './migrate.ts';
import { inList } from './sql.ts';

const GENRE = `genre TEXT CHECK (genre IS NULL OR genre IN ${inList(['report', 'letter'])})`;

const REWRITES = `CREATE TABLE space_rewrites (
  space_id TEXT PRIMARY KEY NOT NULL REFERENCES spaces (id),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  done_at TEXT,
  updated_at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0122-space-pages',
  up(db) {
    for (const table of ['spaces', 'space_revisions']) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${GENRE}`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN html TEXT`);
    }
    db.exec(REWRITES);
  },
};
