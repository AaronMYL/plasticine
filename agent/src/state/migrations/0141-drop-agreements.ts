// 旧约定、旧词表、旧设备钥匙退役（11-15 记忆分层第三版，Aaron 弹框同意删这几张表，看过没搬的那几句以后回「删」）。
// - agreements、term_decodings：约定和词表 11-03 起已经迁成记忆文档里的行，11-15 又把授权那几句搬进「承诺和授权」；
//   这两张表早就不进提示，界面上也只剩从记忆行点过去的一页只读。记忆行的出处（agreement / term）留着原来的 id，
//   只当「从旧约定来的」这个记号用。
// - device_keys：设备签名 11 月初就不再当本人确认的门槛，界面这边的签名代码 11-15 已删。
// - 查找索引里这类记录（来源 agreement）一起清掉，免得搜到点不开的东西。
// - versions 里这些对象的改动历史不动（和 0062 删旧表时一样）。
// 线上删之前这三张表先整表导出留底 7 天。

import type { Migration } from './migrate.ts';

const TABLES = ['term_decodings', 'agreements', 'device_keys'] as const;
// 查找索引和它的 FTS 影子表里约定那一类的行也没了。
const SEARCH_TABLES = ['search_docs', 'search_sources', 'search_gaps', 'search_fts_data', 'search_fts_idx',
  'search_fts_docsize'] as const;

export const migration: Migration = {
  id: '0141-drop-agreements',
  destructive: true,
  loses: [...TABLES, ...SEARCH_TABLES],
  up(db) {
    db.exec(`INSERT INTO search_fts (search_fts, rowid, title, body, detail)
      SELECT 'delete', id, title, body, detail FROM search_docs WHERE source = 'agreement'`);
    db.exec("DELETE FROM search_docs WHERE source = 'agreement'");
    db.exec("DELETE FROM search_sources WHERE source = 'agreement'");
    db.exec("DELETE FROM search_gaps WHERE source = 'agreement'");
    for (const table of TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};
