import type { Database, Params, Row } from '../db.ts';
import { StateError } from '../errors.ts';

/** What a migration may do: run DDL / DML text and read rows. It never sees the full database handle. */
export interface MigrationDb {
  exec(sql: string): void;
  all(sql: string, params?: Params): Row[];
  run(sql: string, params?: Params): number;
}

export interface MigrationFiles {
  writeNoteBody(noteId: string, markdown: string): { file: string; bytes: number; sha256: string };
  readNoteBody?(file: string): string;
}

export interface Migration {
  /** `0001-objects`: four digits, then a kebab-case name; applied in this order. */
  id: string;
  destructive?: true;
  changes?: readonly string[];
  up(db: MigrationDb, files: MigrationFiles): void;
}

export const FIRST_DESTRUCTIVE = '0059';

const NO_FILES: MigrationFiles = {
  writeNoteBody() {
    throw new StateError('migration_failed', '这个库没有笔记目录，迁移写不了笔记正文');
  },
};

const ID_PATTERN = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORBIDDEN_STATEMENT = /\b(?:DROP|RENAME|DELETE|REPLACE)\b/i;

const LEDGER_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
)`;

function checkList(migrations: readonly Migration[]): void {
  let previous = '';
  for (const migration of migrations) {
    if (!ID_PATTERN.test(migration.id)) {
      throw new StateError('migration_failed', `迁移编号 ${migration.id} 不合格式（0001-名字）`);
    }
    if (migration.id <= previous) {
      throw new StateError('migration_failed', `迁移 ${migration.id} 排在 ${previous} 后面，编号必须递增且不重复`);
    }
    if (migration.destructive === true && migration.id < FIRST_DESTRUCTIVE) {
      throw new StateError('migration_failed', `迁移 ${migration.id} 早于 ${FIRST_DESTRUCTIVE}，不能标成可以删东西`);
    }
    previous = migration.id;
  }
}

function guarded(db: Database, migration: Migration): MigrationDb {
  const check = (sql: string): void => {
    if (migration.destructive === true) {
      return;
    }
    const forbidden = FORBIDDEN_STATEMENT.exec(sql);
    if (forbidden !== null) {
      const message = `迁移 ${migration.id} 里有 ${forbidden[0].toUpperCase()}：新库的 schema 只加表、加列，不删不改`;
      throw new StateError('forbidden_migration', message);
    }
  };
  return {
    exec(sql: string): void {
      check(sql);
      db.exec(sql);
    },
    all(sql: string, params: Params = {}): Row[] {
      check(sql);
      return db.all(sql, params);
    },
    run(sql: string, params: Params = {}): number {
      check(sql);
      return db.run(sql, params);
    },
  };
}

function checkForeignKeys(db: Database, id: string): void {
  const broken = db.all('PRAGMA foreign_key_check');
  if (broken.length > 0) {
    const first = broken[0]!;
    throw new StateError('migration_failed',
      `迁移 ${id} 之后外键不对：${String(first['table'])} 有 ${broken.length} 行指向 ${String(first['parent'])} 里没有的行`);
  }
}

export function appliedMigrations(db: Database): string[] {
  db.exec(LEDGER_SQL);
  return db.all('SELECT id FROM schema_migrations ORDER BY id').map((row) => String(row['id']));
}

/** Applies what is missing and returns the ids it applied; a second run returns []. */
export function migrate(db: Database, migrations: readonly Migration[], now: () => string,
  files: MigrationFiles = NO_FILES): string[] {
  checkList(migrations);
  const known = new Set(migrations.map((migration) => migration.id));
  const applied = appliedMigrations(db);
  const unknown = applied.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new StateError('migration_failed', `库里有代码不认识的迁移 ${unknown.join('、')}：库比这份代码新，不能打开`);
  }
  const done = new Set(applied);
  const pending = migrations.filter((migration) => !done.has(migration.id));
  if (pending.length === 0) {
    return [];
  }
  let current = '';
  const destructive = pending.some((migration) => migration.destructive === true);
  if (destructive) {
    db.exec('PRAGMA foreign_keys = OFF');
  }
  try {
    db.transaction(() => {
      for (const migration of pending) {
        current = migration.id;
        migration.up(guarded(db, migration), files);
        db.run('INSERT INTO schema_migrations (id, applied_at) VALUES ($id, $applied_at)', {
          id: migration.id,
          applied_at: now(),
        });
      }
      if (destructive) {
        checkForeignKeys(db, current);
      }
    });
  } catch (error) {
    if (error instanceof StateError && error.code === 'forbidden_migration') {
      throw error;
    }
    throw new StateError('migration_failed', `迁移 ${current} 失败，这一批已整体回滚`, { cause: error });
  } finally {
    if (destructive) {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return pending.map((migration) => migration.id);
}
