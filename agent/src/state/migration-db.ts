import { DatabaseSync } from 'node:sqlite';
import type { MigrationMode } from '../../shared/api/migration.ts';
import { openState } from './service.ts';
import { MIGRATIONS } from './migrations/index.ts';
import { StateError } from './errors.ts';
import { tablesOf } from './migration-tables.ts';

export interface MigrationDbCounts {
  lines: number;
  memory: number;
  notes: number;
  books: number;
  spaces: number;
}

export function tableNames(db: DatabaseSync, schema = 'main'): Set<string> {
  const rows = db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all();
  return new Set(rows.map((row) => String(row['name'])));
}

function count(db: DatabaseSync, sql: string): number {
  return Number(db.prepare(sql).get()?.['n'] ?? 0);
}

export function withoutForeignKeys<T>(db: DatabaseSync, work: () => T): T {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function repairForeignKeys(db: DatabaseSync, newerThan?: ReadonlyMap<string, number>): number {
  let touched = 0;
  for (let round = 0; round < 20; round += 1) {
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    const fixable = broken.filter((row) => newerThan === undefined
      || Number(row['rowid']) > (newerThan.get(String(row['table'])) ?? Number.MAX_SAFE_INTEGER));
    if (fixable.length === 0) {
      return touched;
    }
    for (const row of fixable) {
      const table = String(row['table']);
      const id = Number(row['fkid']);
      const keys = db.prepare(`PRAGMA foreign_key_list("${table}")`).all().filter((key) => Number(key['id']) === id);
      const columns = keys.map((key) => String(key['from']));
      const info = db.prepare(`PRAGMA table_info("${table}")`).all();
      const nullable = columns.every((name) => info.some((column) => column['name'] === name
        && column['notnull'] === 0));
      if (nullable) {
        db.prepare(`UPDATE "${table}" SET ${columns.map((name) => `"${name}" = NULL`).join(', ')} WHERE rowid = ?`)
          .run(Number(row['rowid']));
      } else {
        db.prepare(`DELETE FROM "${table}" WHERE rowid = ?`).run(Number(row['rowid']));
      }
      touched += 1;
    }
  }
  throw new StateError('invalid_input', '外键修了 20 轮还没修完');
}

export function stripSnapshot(path: string, mode: MigrationMode): void {
  const db = new DatabaseSync(path);
  try {
    const present = tableNames(db);
    const drop = [...tablesOf('local'), ...(mode === 'data' ? tablesOf('machine') : [])]
      .filter((name) => present.has(name));
    withoutForeignKeys(db, () => {
      for (const name of drop) {
        db.exec(`DELETE FROM "${name}"`);
      }
    });
    db.exec('VACUUM');
  } finally {
    db.close();
  }
}

export function contentCounts(path: string): MigrationDbCounts {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      lines: count(db, 'SELECT count(*) AS n FROM lines'),
      memory: count(db, 'SELECT count(*) AS n FROM memory_doc_lines WHERE deleted_at IS NULL AND retired_at IS NULL'
        + ' AND archived_at IS NULL'),
      notes: count(db, 'SELECT count(*) AS n FROM notes WHERE deleted_at IS NULL AND purged_at IS NULL'),
      books: count(db, 'SELECT count(*) AS n FROM books WHERE deleted_at IS NULL AND purged_at IS NULL'),
      spaces: count(db, 'SELECT count(*) AS n FROM spaces WHERE deleted_at IS NULL AND purged_at IS NULL'),
    };
  } finally {
    db.close();
  }
}

export function schemaOf(path: string): string[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (!tableNames(db).has('schema_migrations')) {
      return [];
    }
    return db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((row) => String(row['id']));
  } finally {
    db.close();
  }
}

export function handleOf(path: string): string | null {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('SELECT handle FROM network_identity ORDER BY created_at LIMIT 1').get();
    return row === undefined ? null : String(row['handle']);
  } finally {
    db.close();
  }
}

export function unknownMigrations(schema: readonly string[]): string[] {
  const known = new Set(MIGRATIONS.map((migration) => migration.id));
  return schema.filter((id) => !known.has(id));
}

export function upgradeStaged(path: string, notesDirectory: string, booksDirectory: string): void {
  const unknown = unknownMigrations(schemaOf(path));
  if (unknown.length > 0) {
    throw new StateError('migration_failed', '这一份是更新的版本导出的');
  }
  const state = openState({ path, notesDirectory, booksDirectory });
  state.close();
}

export function copyDatabase(from: string, to: string): void {
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(to);
  } finally {
    db.close();
  }
}

export function keepMachineTables(stagedPath: string, currentPath: string, mode: MigrationMode): void {
  const db = new DatabaseSync(stagedPath);
  try {
    db.prepare("ATTACH DATABASE ? AS here").run(currentPath);
    const there = tableNames(db, 'main');
    const here = tableNames(db, 'here');
    const keep = [...tablesOf('local'), ...(mode === 'data' ? tablesOf('machine') : [])]
      .filter((name) => there.has(name) && here.has(name));
    withoutForeignKeys(db, () => {
      for (const name of keep) {
        const columns = db.prepare(`PRAGMA main.table_info("${name}")`).all().map((row) => `"${String(row['name'])}"`);
        const list = columns.join(', ');
        db.exec(`DELETE FROM main."${name}"`);
        db.exec(`INSERT INTO main."${name}" (${list}) SELECT ${list} FROM here."${name}"`);
      }
      repairForeignKeys(db);
    });
    db.exec('DETACH DATABASE here');
  } finally {
    db.close();
  }
}

export function resetSearchIndex(db: DatabaseSync): void {
  const present = tableNames(db);
  for (const name of ['search_docs', 'search_gaps', 'search_sources']) {
    if (present.has(name)) {
      db.exec(`DELETE FROM "${name}"`);
    }
  }
  if (present.has('search_fts')) {
    db.exec("INSERT INTO search_fts (search_fts) VALUES ('rebuild')");
  }
}
