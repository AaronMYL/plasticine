import { ClientPublicationSchema, type ClientPublication } from '../../shared/api/client-updates.ts';
import { checked } from './codec.ts';
import type { StoreContext } from './object-store.ts';

export function createClientPublicationStore({ db }: StoreContext) {
  return {
    publish(receipt: ClientPublication): boolean {
      const value = checked(ClientPublicationSchema, receipt, 'invalid_input', '客户端发布回执');
      return db.run('INSERT OR IGNORE INTO client_publications (id, metadata) VALUES ($id, $metadata)', {
        id: value.id,
        metadata: JSON.stringify(value),
      }) > 0;
    },
  };
}

export type ClientPublicationStore = ReturnType<typeof createClientPublicationStore>;
