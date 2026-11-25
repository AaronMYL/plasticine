import type { SoulApi } from '../soul-client.ts';
import { ConflictListResponseSchema, MEMORY_CONFLICTS_PATH, memoryConflictPath, SOUL_PATH,
  SoulViewSchema } from '../shared.ts';
import type { Transport } from './transport.ts';

export function createSoulHttp(transport: Transport): SoulApi {
  return {
    get: (signal) => transport.request({ method: 'GET', path: SOUL_PATH, schema: SoulViewSchema,
      what: '读取规则', lostAs: 'failed', signal }),
    change: (body) => transport.request({ method: 'POST', path: SOUL_PATH, body, schema: SoulViewSchema,
      what: '修改规则', lostAs: 'uncertain' }),
    conflicts: (signal) => transport.request({ method: 'GET', path: MEMORY_CONFLICTS_PATH,
      schema: ConflictListResponseSchema, what: '读取说法冲突', lostAs: 'failed', signal }),
    resolveConflict: (id, body) => transport.request({ method: 'POST', path: `${memoryConflictPath(id)}/resolve`,
      body, schema: ConflictListResponseSchema, what: '选以哪条为准', lostAs: 'uncertain' }),
  };
}
