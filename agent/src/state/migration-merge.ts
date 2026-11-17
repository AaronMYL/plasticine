// 数据迁移的合并（11-16 设计稿：合并＝这台的都留着，把文件里这台没有的加进来；两边都有的同一条留这台的）。
// 只在服务启动前跑（库没有别的连接）；导进来的那份是暂存里的副本，先在它身上改好再并：
//   另一台的对话都按「已归档」进来、不在这台接着跑，另一台的主线变成一条旁聊「@名字 的主线」；
//   还开着的卡收回，在跑的定时任务和订阅先暂停；和这台重名的队友名字后面加「（另一台）」；
//   同一个联系人、同一个信息源、同一封信（按它们自己的唯一键认）指到这台那一条上，底下的东西跟过来。
// 只并「content」那一类表；插不进的（编号一样）就是两边都有的，留这台的。并完外键对不上的新行修掉，全文索引重建。

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tablesOf } from './migration-tables.ts';
import {
  contentCounts, repairForeignKeys, resetSearchIndex, tableNames, withoutForeignKeys, type MigrationDbCounts,
} from './migration-db.ts';

export interface MergeOutcome {
  /** 加进来多少（对话、记忆、笔记、书、空间）。 */
  added: MigrationDbCounts;
  /** 两边都有、留了这台的行数。 */
  kept: number;
}

/** 按自己的唯一键认同一个东西的几张表；extra 是没写成外键、但也指着它的列。 */
const NATURAL_KEYS: ReadonlyArray<{ table: string; key: string; extra?: ReadonlyArray<[string, string]> }> = [
  { table: 'contacts', key: 'account_id' },
  { table: 'feed_sources', key: 'ref' },
  { table: 'feed_items', key: 'dedupe_key' },
  { table: 'inbox_messages', key: 'message_id' },
  { table: 'rules', key: 'code' },
  { table: 'memory_docs', key: 'project_id', extra: [['memory_journal', 'doc_id'], ['memory_doc_events', 'doc_id']] },
];

/** 指着对话线、但没写成外键的列。 */
const LINE_REFS: ReadonlyArray<[string, string]> = [
  ['schedules', 'line_id'], ['suggestions', 'line_id'], ['space_subscriptions', 'line_id'],
  ['space_revisions', 'line_id'],
];
/** 记忆里按 JSON 记着出处（哪条线第几句）的列。 */
const ANCHOR_COLUMNS: ReadonlyArray<[string, string]> = [
  ['memory_doc_lines', 'anchors'], ['memory_journal', 'anchors'], ['memory_inferences', 'anchors'],
];

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** 导进来那份里外键指着 table 的列，加上 extra。 */
function referencesTo(db: DatabaseSync, sourceTables: ReadonlySet<string>, table: string,
  extra: ReadonlyArray<[string, string]> = []): Array<[string, string]> {
  const refs: Array<[string, string]> = extra.filter(([child]) => sourceTables.has(child));
  for (const child of sourceTables) {
    for (const fk of db.prepare(`PRAGMA src.foreign_key_list(${quoted(child)})`).all()) {
      if (String(fk['table']) === table) {
        refs.push([child, String(fk['from'])]);
      }
    }
  }
  return refs;
}

/**
 * 主线在每台都是同一个编号（line-main）：另一台的主线先换个新编号，底下的消息、分段、推送和记忆里的出处跟着改，
 * 不然会并进这台的主线。
 */
function relinkMainLine(db: DatabaseSync, sourceTables: ReadonlySet<string>): void {
  const row = db.prepare("SELECT id FROM src.lines WHERE kind = 'main'").get();
  if (row === undefined) {
    return;
  }
  const old = String(row['id']);
  const fresh = `line-${randomUUID()}`;
  for (const [child, column] of referencesTo(db, sourceTables, 'lines', LINE_REFS)) {
    db.prepare(`UPDATE src.${quoted(child)} SET ${quoted(column)} = ? WHERE ${quoted(column)} = ?`).run(fresh, old);
  }
  for (const [table, column] of ANCHOR_COLUMNS.filter(([name]) => sourceTables.has(name))) {
    db.prepare(`UPDATE src.${quoted(table)} SET ${quoted(column)} = replace(${quoted(column)}, ?, ?)
      WHERE instr(${quoted(column)}, ?) > 0`).run(`"${old}"`, `"${fresh}"`, `"${old}"`);
  }
  db.prepare('UPDATE src.lines SET id = ? WHERE id = ?').run(fresh, old);
}

/** 导进来的那份先改好：对话归档且不再跑、卡收回、定时和订阅暂停、重名队友改名。 */
function settleSource(db: DatabaseSync, sourceTables: ReadonlySet<string>, at: string, label: string): void {
  relinkMainLine(db, sourceTables);
  const run = (sql: string, ...params: Array<string | number | null>): void => {
    db.prepare(sql).run(...params);
  };
  run("UPDATE src.lines SET kind = 'side', title = ? WHERE kind = 'main'", `${label} 的主线`);
  run(`UPDATE src.lines SET status = 'paused', pause_reason = 'stopped', paused_until = NULL
    WHERE status IN ('queued', 'running', 'waiting')
      OR (status = 'paused' AND coalesce(pause_reason, '') != 'stopped')`);
  run('UPDATE src.lines SET archived_at = ? WHERE archived_at IS NULL', at);
  run("UPDATE src.asks SET status = 'withdrawn', withdrawn_at = ? WHERE status = 'open'", at);
  run("UPDATE src.schedules SET status = 'paused' WHERE status = 'active'");
  run("UPDATE src.space_subscriptions SET status = 'paused' WHERE status = 'active'");
  run(`UPDATE src.mates SET name = name || '（另一台）'
    WHERE disabled_at IS NULL AND id NOT IN (SELECT id FROM main.mates)
      AND lower(name) IN (SELECT lower(name) FROM main.mates WHERE disabled_at IS NULL)`);
}

/** 同一个东西在两台编号不同：导进来那份里的编号和指着它的列都改成这台的。 */
function remapNaturalKeys(db: DatabaseSync, sourceTables: ReadonlySet<string>): void {
  for (const { table, key, extra = [] } of NATURAL_KEYS) {
    if (!sourceTables.has(table)) {
      continue;
    }
    db.exec('DROP TABLE IF EXISTS temp.migration_map');
    db.exec(`CREATE TEMP TABLE migration_map AS SELECT s.id AS map_old, m.id AS map_new
      FROM src.${quoted(table)} s JOIN main.${quoted(table)} m ON s.${quoted(key)} = m.${quoted(key)}
      WHERE s.${quoted(key)} IS NOT NULL AND s.id != m.id`);
    for (const [child, column] of referencesTo(db, sourceTables, table, extra)) {
      db.exec(`UPDATE src.${quoted(child)} SET ${quoted(column)} =
        (SELECT map_new FROM temp.migration_map WHERE map_old = ${quoted(column)})
        WHERE ${quoted(column)} IN (SELECT map_old FROM temp.migration_map)`);
    }
    db.exec(`UPDATE OR IGNORE src.${quoted(table)} SET id = (SELECT map_new FROM temp.migration_map WHERE map_old = id)
      WHERE id IN (SELECT map_old FROM temp.migration_map)`);
    db.exec('DROP TABLE temp.migration_map');
  }
}

function columnsOf(db: DatabaseSync, schema: string, table: string): string[] {
  return db.prepare(`PRAGMA ${schema}.table_info(${quoted(table)})`).all().map((row) => String(row['name']));
}

/** 把导进来的那份（已经升到这份代码的结构）并进这台的库。 */
export function mergeDatabase(currentPath: string, stagedPath: string, options: { at: string; label: string }):
  MergeOutcome {
  const before = contentCounts(currentPath);
  const db = new DatabaseSync(currentPath);
  let kept = 0;
  try {
    db.prepare('ATTACH DATABASE ? AS src').run(stagedPath);
    const here = tableNames(db, 'main');
    const there = tableNames(db, 'src');
    const tables = tablesOf('content').filter((name) => here.has(name) && there.has(name));
    withoutForeignKeys(db, () => {
      settleSource(db, there, options.at, options.label);
      remapNaturalKeys(db, there);
      const last = new Map(tables.map((name) => [name,
        Number(db.prepare(`SELECT coalesce(max(rowid), 0) AS n FROM main.${quoted(name)}`).get()?.['n'] ?? 0)]));
      for (const name of tables) {
        const shared = new Set(columnsOf(db, 'src', name));
        const list = columnsOf(db, 'main', name).filter((column) => shared.has(column)).map(quoted).join(', ');
        const offered = Number(db.prepare(`SELECT count(*) AS n FROM src.${quoted(name)}`).get()?.['n'] ?? 0);
        const result = db.prepare(`INSERT OR IGNORE INTO main.${quoted(name)} (${list})
          SELECT ${list} FROM src.${quoted(name)}`).run();
        kept += offered - Number(result.changes);
      }
      repairForeignKeys(db, last);
      resetSearchIndex(db);
    });
    db.exec('DETACH DATABASE src');
  } finally {
    db.close();
  }
  const after = contentCounts(currentPath);
  return {
    added: {
      lines: after.lines - before.lines,
      memory: after.memory - before.memory,
      notes: after.notes - before.notes,
      books: after.books - before.books,
      spaces: after.spaces - before.spaces,
    },
    kept,
  };
}
