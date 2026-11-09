// 旧空间按新版式重写的记录（迁移 0122，第 8 批第 6 条）：一个空间一行。做成了记 done_at，重启不再做；没做成记次数和
// 一句原因，下次启动再试。什么时候试、试几次由 subs/ 的重写活决定，这里只存。

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
    /** 试了一次没成：次数加一、记原因（一句话，不带正文）。 */
    failed(spaceId: string, reason: string): SpaceRewrite {
      return write(spaceId, (get(spaceId)?.attempts ?? 0) + 1, reason, null);
    },
    /** 重写成了。 */
    done(spaceId: string): SpaceRewrite {
      return write(spaceId, (get(spaceId)?.attempts ?? 0) + 1, null, context.now());
    },
  };
}

export type SpaceRewriteStore = ReturnType<typeof createSpaceRewriteStore>;
