import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tablesOf } from './migration-tables.ts';
import {
  contentCounts, repairForeignKeys, resetSearchIndex, tableNames, withoutForeignKeys, type MigrationDbCounts,
} from './migration-db.ts';

export interface MergeOutcome {
  added: MigrationDbCounts;
  kept: number;
}

const NATURAL_KEYS: ReadonlyArray<{ table: string; key: string; extra?: ReadonlyArray<[string, string]> }> = [
  { table: 'contacts', key: 'account_id' },
  { table: 'feed_sources', key: 'ref' },
  { table: 'feed_items', key: 'dedupe_key' },
  { table: 'inbox_messages', key: 'message_id' },
  { table: 'memory_docs', key: 'project_id', extra: [['memory_journal', 'doc_id'], ['memory_doc_events', 'doc_id']] },
];

const LINE_REFS: ReadonlyArray<[string, string]> = [
  ['schedules', 'line_id'], ['suggestions', 'line_id'], ['space_subscriptions', 'line_id'],
  ['space_revisions', 'line_id'],
];
const ANCHOR_COLUMNS: ReadonlyArray<[string, string]> = [
  ['memory_doc_lines', 'anchors'], ['memory_journal', 'anchors'], ['memory_inferences', 'anchors'],
];

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

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

function primaryKey(db: DatabaseSync, table: string): string[] {
  return db.prepare(`PRAGMA main.table_info(${quoted(table)})`).all()
    .filter((row) => Number(row['pk']) > 0)
    .sort((left, right) => Number(left['pk']) - Number(right['pk']))
    .map((row) => String(row['name']));
}

function insertMissing(db: DatabaseSync, table: string): number {
  const shared = new Set(columnsOf(db, 'src', table));
  const list = columnsOf(db, 'main', table).filter((column) => shared.has(column)).map(quoted).join(', ');
  const key = primaryKey(db, table);
  const missing = key.length === 0 ? '1'
    : `NOT EXISTS (SELECT 1 FROM main.${quoted(table)} m WHERE ${key.map((column) =>
      `m.${quoted(column)} IS s.${quoted(column)}`).join(' AND ')})`;
  const insert = `INSERT OR IGNORE INTO main.${quoted(table)} (${list}) SELECT ${list.split(', ')
    .map((column) => `s.${column}`).join(', ')} FROM src.${quoted(table)} s WHERE ${missing}`;
  db.exec('SAVEPOINT migration_table');
  try {
    const changes = Number(db.prepare(insert).run().changes);
    db.exec('RELEASE migration_table');
    return changes;
  } catch {
    db.exec('ROLLBACK TO migration_table');
    db.exec('RELEASE migration_table');
  }
  let changes = 0;
  const rowids = db.prepare(`SELECT s.rowid AS r FROM src.${quoted(table)} s WHERE ${missing}`).all();
  const one = db.prepare(`${insert} AND s.rowid = ?`);
  for (const row of rowids) {
    db.exec('SAVEPOINT migration_row');
    try {
      changes += Number(one.run(Number(row['r'])).changes);
      db.exec('RELEASE migration_row');
    } catch {
      db.exec('ROLLBACK TO migration_row');
      db.exec('RELEASE migration_row');
    }
  }
  return changes;
}

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
        const offered = Number(db.prepare(`SELECT count(*) AS n FROM src.${quoted(name)}`).get()?.['n'] ?? 0);
        kept += offered - insertMissing(db, name);
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
