// The one error type state/ throws. `code` is snake_case so app/ can map it straight onto the API error format
// (《实施方案》第 5 节：`{ error, code, field?, next? }`, 409 carries the current version).

export const STATE_ERROR_CODES = [
  'version_conflict',
  'not_found',
  'invalid_input',
  'confirmation_required',
  'duplicate',
  'corrupt_record',
  'writer_already_open',
  'migration_failed',
  'forbidden_migration',
  'not_synchronous',
] as const;
export type StateErrorCode = (typeof STATE_ERROR_CODES)[number];

export interface StateErrorDetails {
  field?: string;
  currentVersion?: number;
  cause?: unknown;
}

export class StateError extends Error {
  readonly code: StateErrorCode;
  readonly field: string | undefined;
  readonly currentVersion: number | undefined;

  constructor(code: StateErrorCode, message: string, details: StateErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'StateError';
    this.code = code;
    this.field = details.field;
    this.currentVersion = details.currentVersion;
  }
}

export function versionConflict(table: string, id: string, expected: number, current: number): StateError {
  const message = `${table} ${id} 已被改过：你基于第 ${expected} 版，现在是第 ${current} 版。请先读最新版再改。`;
  return new StateError('version_conflict', message, { currentVersion: current });
}

export function notFound(table: string, id: string): StateError {
  return new StateError('not_found', `${table} 里没有 ${id}`);
}

// Extended result codes from https://www.sqlite.org/rescode.html.
const SQLITE_CONSTRAINT_CHECK = 275;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;
const SQLITE_CONSTRAINT_NOTNULL = 1299;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

function sqliteCode(error: unknown): number | undefined {
  if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number') {
    return error.errcode;
  }
  return undefined;
}

/** Maps a constraint failure onto a StateError (keeping the original as cause); anything else is returned as is. */
export function fromSqliteError(error: unknown, context: string): unknown {
  const code = sqliteCode(error);
  if (code === SQLITE_CONSTRAINT_PRIMARYKEY || code === SQLITE_CONSTRAINT_UNIQUE) {
    return new StateError('duplicate', `${context}：已经有同一标识的记录`, { cause: error });
  }
  if (code === SQLITE_CONSTRAINT_FOREIGNKEY) {
    return new StateError('invalid_input', `${context}：引用的对象不存在`, { cause: error });
  }
  if (code === SQLITE_CONSTRAINT_CHECK || code === SQLITE_CONSTRAINT_NOTNULL) {
    return new StateError('invalid_input', `${context}：库的约束拒绝了这个值`, { cause: error });
  }
  return error;
}
