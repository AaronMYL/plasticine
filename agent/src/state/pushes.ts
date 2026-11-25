import { randomUUID } from 'node:crypto';
import type { Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export interface PushRow {
  id: string;
  lineId: string;
  title: string;
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
    recent(limit: number): PushRow[] {
      return db.all('SELECT * FROM pushes ORDER BY created_at DESC, id DESC LIMIT $limit', { limit }).map(pushOf);
    },
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
