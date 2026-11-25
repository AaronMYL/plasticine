import type { SystemsApi } from '../systems-client.ts';
import { SystemOperationsSchema, SYSTEM_OPERATIONS_PATH } from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpSystems implements SystemsApi {
  readonly #transport: Transport;
  constructor(transport: Transport) { this.#transport = transport; }
  operations(signal?: AbortSignal) {
    return this.#transport.request({ method: 'GET', path: SYSTEM_OPERATIONS_PATH,
      schema: SystemOperationsSchema, what: '读运行记录', lostAs: 'failed', signal });
  }
}
