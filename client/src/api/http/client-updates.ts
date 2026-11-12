import type { ClientUpdatesApi } from '../client.ts';
import { ClientUpdateSchema, ClientVersionSchema, type ClientUpdateDecision } from '../shared.ts';
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
  decide(id: string, body: ClientUpdateDecision) {
    return this.transport.request({
      method: 'POST',
      path: `/v2/self/client-updates/${encodeURIComponent(id)}/decision`,
      body,
      schema: ClientUpdateSchema,
      what: '提请客户端发布',
      lostAs: 'uncertain',
    });
  }
}
