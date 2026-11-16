// 他在设置里连的服务（迁移 0146 的 connections，11-16 通用连接）：名字、连接地址、拿到的工具清单、开没开、连没连上。
// 令牌不在这里：存在凭据目录（credentials/），这里只记凭据的名字。删掉只记 deleted_at。

import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { ConnectionToolSchema, type ConnectionTool } from '../../shared/api/connections.ts';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface ConnectionRow {
  id: string;
  name: string;
  url: string;
  credential: string | null;
  enabled: boolean;
  tools: ConnectionTool[];
  status: 'untested' | 'ok' | 'error';
  error: string | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toolsOf(value: unknown): ConnectionTool[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : [];
  return Array.isArray(parsed)
    ? parsed.filter((tool): tool is ConnectionTool => Value.Check(ConnectionToolSchema, tool)) : [];
}

function maybe(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function connectionOf(row: Row): ConnectionRow {
  return { id: String(row['id']), name: String(row['name']), url: String(row['url']),
    credential: maybe(row, 'credential'), enabled: row['enabled'] === 1, tools: toolsOf(row['tools']),
    status: String(row['status']) as ConnectionRow['status'], error: maybe(row, 'error'),
    checkedAt: maybe(row, 'checked_at'), createdAt: String(row['created_at']), updatedAt: String(row['updated_at']) };
}

export function createConnectionStore(context: StoreContext) {
  const { db } = context;
  const get = (id: string): ConnectionRow | undefined => {
    const row = db.get('SELECT * FROM connections WHERE id = $id AND deleted_at IS NULL', { id });
    return row === undefined ? undefined : connectionOf(row);
  };
  const require = (id: string): ConnectionRow => {
    const found = get(id);
    if (found === undefined) {
      throw new StateError('not_found', `没有这个连接：${id}`);
    }
    return found;
  };
  return {
    get,
    require,
    list(): ConnectionRow[] {
      return db.all('SELECT * FROM connections WHERE deleted_at IS NULL ORDER BY created_at').map(connectionOf);
    },
    /** 按名字找（模型按名字叫），不分大小写。 */
    byName(name: string): ConnectionRow | undefined {
      const row = db.get(`SELECT * FROM connections WHERE deleted_at IS NULL AND lower(name) = lower($name)`,
        { name });
      return row === undefined ? undefined : connectionOf(row);
    },
    create(input: { name: string; url: string }): ConnectionRow {
      const id = `conn_${randomUUID()}`;
      const at = context.now();
      db.run(`INSERT INTO connections (id, name, url, credential, status, created_at, updated_at)
        VALUES ($id, $name, $url, NULL, 'untested', $at, $at)`, { id, name: input.name, url: input.url, at });
      return require(id);
    },
    update(id: string, patch: { name?: string; url?: string; credential?: string | null; enabled?: boolean })
      : ConnectionRow {
      const before = require(id);
      const next = { ...before, ...patch };
      const reset = patch.url !== undefined && patch.url !== before.url;
      db.run(`UPDATE connections SET name = $name, url = $url, credential = $credential, enabled = $enabled,
        status = $status, tools = $tools, updated_at = $at WHERE id = $id`, { id, name: next.name, url: next.url,
        credential: next.credential, enabled: next.enabled ? 1 : 0, status: reset ? 'untested' : before.status,
        tools: JSON.stringify(reset ? [] : before.tools), at: context.now() });
      return require(id);
    },
    /** 测过一次：连上了记下工具清单，没连上记原因（工具清单留着上次的）。 */
    checked(id: string, result: { tools: ConnectionTool[] } | { error: string }): ConnectionRow {
      require(id);
      const at = context.now();
      if ('tools' in result) {
        db.run(`UPDATE connections SET status = 'ok', error = NULL, tools = $tools, checked_at = $at, updated_at = $at
          WHERE id = $id`, { id, tools: JSON.stringify(result.tools), at });
      } else {
        db.run(`UPDATE connections SET status = 'error', error = $error, checked_at = $at, updated_at = $at
          WHERE id = $id`, { id, error: result.error, at });
      }
      return require(id);
    },
    remove(id: string): void {
      require(id);
      db.run('UPDATE connections SET deleted_at = $at, updated_at = $at WHERE id = $id', { id, at: context.now() });
    },
  };
}

export type ConnectionStore = ReturnType<typeof createConnectionStore>;
