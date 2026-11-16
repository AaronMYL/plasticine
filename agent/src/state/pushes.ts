// 推到他手机上的每一条（迁移 0146 的 pushes，push_notify 工具写）：谁推的（哪条线）、推了什么、什么时候、撤回没有。
// 同一次调用重跑（call_key）认回同一行，不推第二次。

import { randomUUID } from 'node:crypto';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface PushRow {
  id: string;
  lineId: string;
  title: string;
  /** 点开去哪：站内路径。 */
  url: string;
  createdAt: string;
  withdrawnAt: string | null;
}

function pushOf(row: Row): PushRow {
  const withdrawn = row['withdrawn_at'];
  return { id: String(row['id']), lineId: String(row['line_id']), title: String(row['title']), url: String(row['url']),
    createdAt: String(row['created_at']), withdrawnAt: withdrawn === null || withdrawn === undefined ? null
      : String(withdrawn) };
}

export function createPushStore(context: StoreContext) {
  const { db } = context;
  const get = (id: string): PushRow | undefined => {
    const row = db.get('SELECT * FROM pushes WHERE id = $id', { id });
    return row === undefined ? undefined : pushOf(row);
  };
  return {
    get,
    /** 记一条；同一次调用已经记过就回那一条（created 是 false）。 */
    add(input: { lineId: string; callKey: string; title: string; url: string }): { push: PushRow; created: boolean } {
      const existing = db.get('SELECT * FROM pushes WHERE call_key = $key', { key: input.callKey });
      if (existing !== undefined) {
        return { push: pushOf(existing), created: false };
      }
      const id = `push_${randomUUID()}`;
      db.run(`INSERT INTO pushes (id, line_id, call_key, title, url, created_at)
        VALUES ($id, $line, $key, $title, $url, $at)`,
      { id, line: input.lineId, key: input.callKey, title: input.title, url: input.url, at: context.now() });
      return { push: get(id)!, created: true };
    },
    /** 最近的，新的在前。 */
    recent(limit: number): PushRow[] {
      return db.all('SELECT * FROM pushes ORDER BY created_at DESC, id DESC LIMIT $limit', { limit }).map(pushOf);
    },
    /** 撤回：记下时间；已经撤过的不动。 */
    withdraw(id: string): PushRow {
      const before = get(id);
      if (before === undefined) {
        throw new StateError('not_found', `没有这条推送：${id}`);
      }
      if (before.withdrawnAt === null) {
        db.run('UPDATE pushes SET withdrawn_at = $at WHERE id = $id', { id, at: context.now() });
      }
      return get(id)!;
    },
  };
}

export type PushStore = ReturnType<typeof createPushStore>;
