// The SQLite connection. state/ is the only writer of plasticine.sqlite (plasticine-code「目录与边界」), and inside
// one process there is exactly one connection per file, so every write goes through one queue of transactions.
// node:sqlite is synchronous: a transaction is a plain function call and nothing else can interleave with it.

import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { isAsyncFunction } from 'node:util/types';
import { StateError } from './errors.ts';

export const MEMORY_DATABASE = ':memory:';
// How long a write waits for another connection's lock (a backup reader, the sqlite3 shell) before failing.
// 5 s covers a WAL checkpoint on a 2-core host with room to spare; longer would stall a user request.
export const BUSY_TIMEOUT_MS = 5_000;

export type Row = Record<string, SQLOutputValue>;
export type Params = Record<string, SQLInputValue>;

const openWriters = new Set<string>();

function isThenable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}

export class Database {
  readonly #db: DatabaseSync;
  readonly #writerKey: string | undefined;
  readonly #statements = new Map<string, StatementSync>();
  #depth = 0;

  constructor(db: DatabaseSync, writerKey: string | undefined) {
    this.#db = db;
    this.#writerKey = writerKey;
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  run(sql: string, params: Params = {}): number {
    return Number(this.#prepare(sql).run(params).changes);
  }

  get(sql: string, params: Params = {}): Row | undefined {
    return this.#prepare(sql).get(params);
  }

  all(sql: string, params: Params = {}): Row[] {
    return this.#prepare(sql).all(params);
  }

  /**
   * Runs `work` atomically. The outermost call takes the write lock up front (BEGIN IMMEDIATE, harness 5.3) so it
   * never fails half-way on a lock upgrade; nested calls become savepoints and roll back only their own part.
   */
  transaction<T>(work: () => T): T {
    if (isAsyncFunction(work)) {
      throw new StateError('not_synchronous', '事务里的操作必须是同步的；不能启动异步回调');
    }
    const outermost = this.#depth === 0;
    const savepoint = `state_${this.#depth}`;
    this.#db.exec(outermost ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.#depth += 1;
    let result: T;
    try {
      result = work();
      if (isThenable(result)) {
        throw new StateError('not_synchronous', '事务里的操作必须是同步的；异步的部分会落在事务之外');
      }
      this.#db.exec(outermost ? 'COMMIT' : `RELEASE ${savepoint}`);
    } catch (error) {
      this.#rollback(outermost, savepoint, error);
      throw error;
    } finally {
      this.#depth -= 1;
    }
    return result;
  }

  /**
   * 「删除」真的从库里抹掉（11-07 他定）：work 在一个事务里跑，期间删掉、改掉的内容由 SQLite 用零覆盖（secure_delete），
   * 库文件里不留原文的字节。只给「忘掉」和记录到期这几处用；别处的删除照旧。
   */
  erasing<T>(work: () => T): T {
    const before = this.#db.prepare('PRAGMA secure_delete').get()?.['secure_delete'];
    this.#db.exec('PRAGMA secure_delete = ON');
    try {
      return this.transaction(work);
    } finally {
      this.#db.exec(`PRAGMA secure_delete = ${before === 1 ? 'ON' : 'OFF'}`);
    }
  }

  close(): void {
    this.#statements.clear();
    this.#db.close();
    if (this.#writerKey !== undefined) {
      openWriters.delete(this.#writerKey);
    }
  }

  #prepare(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  #rollback(outermost: boolean, savepoint: string, original: unknown): void {
    try {
      if (outermost) {
        this.#db.exec('ROLLBACK');
      } else {
        this.#db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      }
    } catch (rollbackError) {
      throw new AggregateError([original, rollbackError], '事务回滚失败，库可能停在半截状态，需要人工核对');
    }
  }
}

function readPragma(db: DatabaseSync, name: string): SQLOutputValue | undefined {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return row === undefined ? undefined : row[name];
}

function configure(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  // WAL lets readers (backups, the copy scripts) run while the agent writes; an in-memory library has no WAL.
  const mode = db.prepare('PRAGMA journal_mode = WAL').get()?.['journal_mode'];
  const expected = path === MEMORY_DATABASE ? 'memory' : 'wal';
  if (mode !== expected) {
    throw new StateError('invalid_input', `${path} 没能切到 WAL 模式（现在是 ${String(mode)}）`);
  }
  if (readPragma(db, 'foreign_keys') !== 1) {
    throw new StateError('invalid_input', `${path} 没能打开外键约束`);
  }
}

/** Opens (creating if needed) the library at `path`. A second open of the same file in this process is refused. */
export function openDatabase(path: string): Database {
  const writerKey = path === MEMORY_DATABASE ? undefined : resolve(path);
  if (writerKey !== undefined && openWriters.has(writerKey)) {
    throw new StateError('writer_already_open', `这个进程已经打开了 ${writerKey}；一个进程只能有一个写入者`);
  }
  const db = new DatabaseSync(path);
  try {
    configure(db, path);
  } catch (error) {
    db.close();
    throw error;
  }
  if (writerKey !== undefined) {
    openWriters.add(writerKey);
  }
  return new Database(db, writerKey);
}
