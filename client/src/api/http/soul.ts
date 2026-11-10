import type { SoulApi } from '../soul-client.ts';
import { SOUL_PATH, SoulViewSchema } from '../shared.ts';
import type { Transport } from './transport.ts';

export function createSoulHttp(transport: Transport): SoulApi {
  return {
    get: (signal) => transport.request({ method: 'GET', path: SOUL_PATH, schema: SoulViewSchema,
      what: '读取 Soul', lostAs: 'failed', signal }),
    change: (body) => transport.request({ method: 'POST', path: SOUL_PATH, body, schema: SoulViewSchema,
      what: '修改 Soul', lostAs: 'uncertain' }),
  };
}
