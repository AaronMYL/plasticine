import { Type } from 'typebox';
import {
  ClientUpdateSchema,
  ClientPublicationSchema,
  type ClientUpdate,
  type ClientPublication,
  type ClientManifest,
} from '../../shared/api/client-updates.ts';
import type { StoreContext } from './object-store.ts';
import { checked, readRow } from './codec.ts';
import { StateError } from './errors.ts';
const Update = Type.Object({ metadata: ClientUpdateSchema });
const Publication = Type.Object({ metadata: ClientPublicationSchema });
export function createClientUpdateStore({ db }: StoreContext) {
  const list = (): ClientUpdate[] =>
    db
      .all('SELECT metadata FROM client_updates ORDER BY rowid DESC')
      .map((row) => readRow(Update, { metadata: 'json' }, row, '客户端候选').metadata);
  // 11-17：按 id 只读这一行。原来每次都把整张表读出来逐行校验（每一行是一份几百个资源的清单），界面每分钟查一次
  // 新版本就要读两三遍，发了一百多版以后一次要半秒多，还占住整个服务。
  const find = (id: string): ClientUpdate | undefined => {
    const row = db.get('SELECT metadata FROM client_updates WHERE id = $id', { id });
    return row === undefined ? undefined : readRow(Update, { metadata: 'json' }, row, '客户端候选').metadata;
  };
  const require = (id: string): ClientUpdate => {
    const row = find(id);
    if (row === undefined) {
      throw new StateError('not_found', '没有这份客户端构建。');
    }
    return row;
  };
  const update = (id: string, patch: Partial<ClientUpdate>): ClientUpdate => {
    const row = checked(ClientUpdateSchema, { ...require(id), ...patch }, 'invalid_input', '客户端记录');
    db.run('UPDATE client_updates SET metadata = $metadata WHERE id = $id', { id, metadata: JSON.stringify(row) });
    return row;
  };
  return {
    list,
    require,
    update,
    register(manifest: ClientManifest): void {
      const existing = find(manifest.buildId);
      if (existing !== undefined && JSON.stringify(existing.manifest) !== JSON.stringify(manifest)) {
        throw new StateError('invalid_input', '构建标识对应的资源已经变更。');
      }
      const row = checked(
        ClientUpdateSchema,
        { manifest, status: 'candidate', selfChangeId: null, taskId: null },
        'invalid_input',
        '客户端候选',
      );
      db.run('INSERT OR IGNORE INTO client_updates (id, metadata) VALUES ($id, $metadata)', {
        id: manifest.buildId,
        metadata: JSON.stringify(row),
      });
    },
    publish(receipt: ClientPublication): boolean {
      const value = checked(ClientPublicationSchema, receipt, 'invalid_input', '客户端发布回执');
      return db.transaction(() => {
        const added = db.run('INSERT OR IGNORE INTO client_publications (id, metadata) VALUES ($id, $metadata)', {
          id: value.id,
          metadata: JSON.stringify(value),
        });
        if (added > 0) {
          update(value.buildId, { status: 'published' });
        }
        return added > 0;
      });
    },
    history(): ClientPublication[] {
      return db
        .all('SELECT metadata FROM client_publications ORDER BY rowid DESC LIMIT 100')
        .map((row) => readRow(Publication, { metadata: 'json' }, row, '客户端发布回执').metadata);
    },
  };
}
