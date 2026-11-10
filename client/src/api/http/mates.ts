import type { MatesApi, MateGroupsApi } from '../mates-client.ts';
import { MATES_PATH, MATE_GROUPS_PATH, MateViewSchema, MateGroupViewSchema, MateListResponseSchema,
  MateHandoffResponseSchema, LegacyChatProposalSchema, LegacyChatConvertResponseSchema } from '../shared.ts';
import type { Transport } from './transport.ts';

export function createMatesHttp(transport: Transport): { mates: MatesApi; mateGroups: MateGroupsApi } {
  return {
    mates: {
      list: (signal) => transport.request({ method: 'GET', path: MATES_PATH, schema: MateListResponseSchema,
        signal, what: '读取队友', lostAs: 'failed' }),
      get: (id, signal) => transport.request({ method: 'GET', path: `${MATES_PATH}/${encodeURIComponent(id)}`,
        schema: MateViewSchema, signal, what: '读取这位队友', lostAs: 'failed' }),
      create: (body) => transport.request({ method: 'POST', path: MATES_PATH, body, schema: MateViewSchema,
        what: '创建队友', lostAs: 'uncertain' }),
      update: (id, body) => transport.request({ method: 'PATCH', path: `${MATES_PATH}/${encodeURIComponent(id)}`,
        body, schema: MateViewSchema, what: '更新队友', lostAs: 'uncertain' }),
      handoff: (body) => transport.request({ method: 'POST', path: `${MATES_PATH}/handoff`, body,
        schema: MateHandoffResponseSchema, what: '交给队友', lostAs: 'uncertain' }),
      prepareLegacy: (lineId) => transport.request({ method: 'POST', path: `${MATES_PATH}/legacy/prepare`,
        body: { lineId }, schema: LegacyChatProposalSchema, what: '整理原来的对话', lostAs: 'failed' }),
      convertLegacy: (body) => transport.request({ method: 'POST', path: `${MATES_PATH}/legacy/convert`, body,
        schema: LegacyChatConvertResponseSchema, what: '转换原来的对话', lostAs: 'uncertain' }),
    },
    mateGroups: {
      create: (body) => transport.request({ method: 'POST', path: MATE_GROUPS_PATH, body, schema: MateGroupViewSchema,
        what: '创建队友群组', lostAs: 'uncertain' }),
      update: (id, body) => transport.request({ method: 'PATCH', path: `${MATE_GROUPS_PATH}/${encodeURIComponent(id)}`,
        body, schema: MateGroupViewSchema, what: '更新队友群组', lostAs: 'uncertain' }),
    },
  };
}
