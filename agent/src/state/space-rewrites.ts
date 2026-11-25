import type { Row } from './db.ts';
import { fromSqliteError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface SpaceRewrite {
  spaceId: string;
  attempts: number;
  lastError: string | null;
  doneAt: string | null;
  updatedAt: string;
}

function readRow(row: Row): SpaceRewrite {
  return {
    spaceId: String(row['space_id']),
    attempts: Number(row['attempts']),
    lastError: row['last_error'] === null || row['last_error'] === undefined ? null : String(row['last_error']),
    doneAt: row['done_at'] === null || row['done_at'] === undefined ? null : String(row['done_at']),
    updatedAt: String(row['updated_at']),
  };
}

export function createSpaceRewriteStore(context: StoreContext) {
  function write(spaceId: string, attempts: number, lastError: string | null, doneAt: string | null): SpaceRewrite {
    const at = context.now();
    try {
      context.db.run(`INSERT INTO space_rewrites (space_id, attempts, last_error, done_at, updated_at)
        VALUES ($space, $attempts, $error, $done, $at)
        ON CONFLICT (space_id) DO UPDATE SET attempts = $attempts, last_error = $error, done_at = $done,
        updated_at = $at`, { space: spaceId, attempts, error: lastError, done: doneAt, at });
    } catch (error) {
      throw fromSqliteError(error, '记空间重写');
    }
    return { spaceId, attempts, lastError, doneAt, updatedAt: at };
  }

  function get(spaceId: string): SpaceRewrite | undefined {
    const row = context.db.get('SELECT * FROM space_rewrites WHERE space_id = $space', { space: spaceId });
    return row === undefined ? undefined : readRow(row);
  }

  return {
    get,
    failed(spaceId: string, reason: string): SpaceRewrite {
      return write(spaceId, (get(spaceId)?.attempts ?? 0) + 1, reason, null);
    },
    done(spaceId: string): SpaceRewrite {
      return write(spaceId, (get(spaceId)?.attempts ?? 0) + 1, null, context.now());
    },
  };
}

export type SpaceRewriteStore = ReturnType<typeof createSpaceRewriteStore>;
