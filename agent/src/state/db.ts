import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { isAsyncFunction } from 'node:util/types';
import { StateError } from './errors.ts';

export const MEMORY_DATABASE = ':memory:';
export const BUSY_TIMEOUT_MS = 5_000;

export type Row = Record<string, SQLOutputValue>;
export type Params = Record<string, SQLInputValue>;

const openWriters = new Set<string>();

function isThenable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}

export const SLOW_QUERY_MS = 200;
let slowQuery: ((sql: string, ms: number) => void) | null = null;

export function watchSlowQueries(callback: ((sql: string, ms: number) => void) | null): void {
  slowQuery = callback;
}

function timed<T>(sql: string, work: () => T): T {
  if (slowQuery === null) {
    return work();
  }
  const started = performance.now();
  const value = work();
  const ms = performance.now() - started;
  if (ms >= SLOW_QUERY_MS) {
    slowQuery(sql, ms);
  }
  return value;
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
    this.#statements.clear();
  }

  run(sql: string, params: Params = {}): number {
    return timed(sql, () => Number(this.#prepare(sql).run(params).changes));
  }

  get(sql: string, params: Params = {}): Row | undefined {
    return timed(sql, () => this.#prepare(sql).get(params));
  }

  all(sql: string, params: Params = {}): Row[] {
    return timed(sql, () => this.#prepare(sql).all(params));
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

  erasing<T>(work: () => T): T {
    const before = this.#db.prepare('PRAGMA secure_delete').get()?.['secure_delete'];
    this.#db.exec('PRAGMA secure_delete = ON');
    try {
      return this.transaction(() => {
        const result = work();
        this.#scrubFreePages();
        return result;
      });
    } finally {
      this.#db.exec(`PRAGMA secure_delete = ${before === 1 ? 'ON' : 'OFF'}`);
    }
  }

  #scrubFreePages(): void {
    const count = (): number => Number(this.#db.prepare('PRAGMA freelist_count').get()?.['freelist_count'] ?? 0);
    if (count() === 0) {
      return;
    }
    const pageSize = Number(this.#db.prepare('PRAGMA page_size').get()?.['page_size'] ?? 4096);
    this.#db.exec('CREATE TABLE erase_scrub (filler BLOB)');
    const fill = this.#db.prepare('INSERT INTO erase_scrub (filler) VALUES (zeroblob($bytes))');
    for (let free = count(), rounds = 0; free > 0 && rounds < 10_000; free = count(), rounds += 1) {
      fill.run({ bytes: Math.min(Math.max(1, free - 1), 2048) * (pageSize - 4) - 64 });
    }
    this.#db.exec('DROP TABLE erase_scrub');
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
