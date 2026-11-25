import type { ClientUpdatesApi } from '../client.ts';
import { ClientVersionSchema } from '../shared.ts';
import type { Transport } from './transport.ts';
export class HttpClientUpdates implements ClientUpdatesApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  list(signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: '/v2/client-version',
      schema: ClientVersionSchema,
      what: '查新版本',
      lostAs: 'failed',
      ...(signal === undefined ? {} : { signal }),
    });
  }
}
