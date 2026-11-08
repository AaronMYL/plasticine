// Runs the numbered schema migrations of plasticine.sqlite. Rules (10-26 第 25 条): the new library's schema only
// gains tables and columns, never drops, renames or rewrites them, and never deletes rows. All pending migrations
// run in one transaction, so a failure leaves the library exactly at the version it had before.
// 例外（2026-11-05 他定：Harness 推倒重做，删掉的功能连表一起删）：标了 destructive 的迁移可以 DROP / DELETE /
// RENAME，只从 0059 起有。这样的迁移跑之前关外键（重建表要先删旧表），整批跑完、提交之前查一遍外键，有一处
// 不对就整批回滚；提交之后再把外键打开。

import type { Database, Params, Row } from '../db.ts';
import { StateError } from '../errors.ts';

/** What a migration may do: run DDL / DML text and read rows. It never sees the full database handle. */
export interface MigrationDb {
  exec(sql: string): void;
  all(sql: string, params?: Params): Row[];
  /** 返回改到的行数。 */
  run(sql: string, params?: Params): number;
}

/** 迁移要写的库外文件（笔记正文）。在内存库（测试）里没有笔记目录，写就报错。 */
export interface MigrationFiles {
  /** 写一篇笔记的正文，返回文件名、字节数和 SHA-256。 */
  writeNoteBody(noteId: string, markdown: string): { file: string; bytes: number; sha256: string };
  /** 读一篇笔记的正文（0084 把「Plasticine 写的」迁成空间）；内存库没有笔记目录时不给。 */
  readNoteBody?(file: string): string;
}

export interface Migration {
  /** `0001-objects`: four digits, then a kebab-case name; applied in this order. */
  id: string;
  /** 删表、删行、改表名的迁移（只从 FIRST_DESTRUCTIVE 起）。 */
  destructive?: true;
  up(db: MigrationDb, files: MigrationFiles): void;
}

/** 第一个可以删东西的迁移；它之前的迁移都是历史，不能补标。 */
export const FIRST_DESTRUCTIVE = '0059';

const NO_FILES: MigrationFiles = {
  writeNoteBody() {
    throw new StateError('migration_failed', '这个库没有笔记目录，迁移写不了笔记正文');
  },
};

const ID_PATTERN = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Dropping, renaming or deleting would lose what the library remembers (《实施方案》统领原则). REPLACE (also as
// INSERT OR REPLACE) deletes the row it collides with before inserting, so it is a delete too (review-followups
// ad5667d).
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

/** 外键检查：有一处指向不存在的行就报出来（删表、重建表之后）。 */
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
  // 外键开关在事务里改不了，只能在事务外面关、开。
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
