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
  const require = (id: string): ClientUpdate => {
    const row = list().find((item) => item.manifest.buildId === id);
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
      const existing = list().find((item) => item.manifest.buildId === manifest.buildId);
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
