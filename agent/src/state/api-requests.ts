// 有副作用的接口请求的回执（《实施方案》第 5 节约定 1）：request_id 是主键。app/ 决定窗口多长、过期了怎么办；
// 这里只存取。过期后同一 id 的新结果覆盖原行（ON CONFLICT 更新）。11-17：过期的行原来从不删（线上攒了五千多行、
// 27 MB，每份备份都带着），现在由 system/record-sweep.ts 定时清掉——过了期的回执本来就不再认。

import { ApiRequestRecordSchema, type ApiRequestRecord } from '../../shared/state.ts';
import { checked, encodeRow, readRow, type ColumnMap } from './codec.ts';
import { fromSqliteError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  requestId: 'text',
  scope: 'text',
  deviceId: 'text',
  status: 'integer',
  body: 'json',
  createdAt: 'text',
  expiresAt: 'text',
  bodyDigest: 'text',
};

const UPSERT_SQL = `INSERT INTO api_requests
    (request_id, scope, device_id, status, body, created_at, expires_at, body_digest)
  VALUES ($request_id, $scope, $device_id, $status, $body, $created_at, $expires_at, $body_digest)
  ON CONFLICT (request_id) DO UPDATE SET scope = excluded.scope, device_id = excluded.device_id,
    status = excluded.status, body = excluded.body, created_at = excluded.created_at,
    expires_at = excluded.expires_at, body_digest = excluded.body_digest`;

export function createApiRequestLog(context: StoreContext) {
  return {
    find(requestId: string): ApiRequestRecord | undefined {
      const row = context.db.get('SELECT * FROM api_requests WHERE request_id = $request_id', {
        request_id: requestId,
      });
      return row === undefined ? undefined : readRow(ApiRequestRecordSchema, COLUMNS, row, 'api_requests');
    },
    /** Stores the answer; an expired row with the same id is overwritten by the new answer. */
    save(record: ApiRequestRecord): ApiRequestRecord {
      const values = checked(ApiRequestRecordSchema, record, 'invalid_input', '记接口回执');
      try {
        context.db.run(UPSERT_SQL, encodeRow(COLUMNS, values));
      } catch (error) {
        throw fromSqliteError(error, '记接口回执');
      }
      return values;
    },
    /** 删掉过期的回执，一次最多 limit 行（多的下一轮接着删）；回删了几行。 */
    purgeExpired(now: string, limit: number): number {
      return context.db.run(`DELETE FROM api_requests WHERE request_id IN (
        SELECT request_id FROM api_requests WHERE expires_at < $now LIMIT $limit)`, { now, limit });
    },
  };
}

export type ApiRequestLog = ReturnType<typeof createApiRequestLog>;
