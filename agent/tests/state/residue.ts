// 「删后库里查不到原文」的查法（11-07 他定「删除」真的从库里抹掉）：每张表（含 FTS 的影子表）逐行逐列找这段字，
// 再用全文索引 MATCH 找一遍；文件层面另由调用方读库文件的字节。

import type { Database } from '../../src/state/db.ts';

/** 哪几张表里还存着这段字（文本列按子串，二进制列按 UTF-8 字节）。 */
export function tablesHolding(db: Database, needle: string): string[] {
  const bytes = Buffer.from(needle, 'utf8');
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((row) => String(row['name']));
  return tables.filter((table) => db.all(`SELECT * FROM "${table}"`).some((row) =>
    Object.values(row).some((value) => (typeof value === 'string' && value.includes(needle))
      || (value instanceof Uint8Array && Buffer.from(value).includes(bytes)))));
}

/** 统一全文索引的 FTS 里还能不能用这段字查到（trigram：三个字以上才走 MATCH）。 */
export function ftsHits(db: Database, needle: string): number {
  const phrase = `"${needle.replaceAll('"', '""')}"`;
  return Number(db.get('SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH $q', { q: phrase })?.['n']);
}
