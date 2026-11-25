import type { OutboundApi } from '../outbound-client.ts';
import { OUTBOUND_GRANTS_PATH, OUTBOUND_LOG_PATH, OutboundGrantListResponseSchema, OutboundGrantResponseSchema,
  OutboundLogListResponseSchema, OutboundLogResponseSchema } from '../shared.ts';
import type { Transport } from './transport.ts';

export function createOutboundHttp(transport: Transport): OutboundApi {
  return {
    grants: async (signal) => (await transport.request({ method: 'GET', path: OUTBOUND_GRANTS_PATH,
      schema: OutboundGrantListResponseSchema, what: '读取对外授权', lostAs: 'failed', signal })).grants,
    logs: async (signal) => (await transport.request({ method: 'GET', path: OUTBOUND_LOG_PATH,
      schema: OutboundLogListResponseSchema, what: '读取发送记录', lostAs: 'failed', signal })).entries,
    log: async (id, signal) => (await transport.request({ method: 'GET',
      path: `${OUTBOUND_LOG_PATH}/${encodeURIComponent(id)}`, schema: OutboundLogResponseSchema,
      what: '读取发送原文', lostAs: 'failed', signal })).entry,
    create: async (body) => (await transport.request({ method: 'POST', path: OUTBOUND_GRANTS_PATH,
      body, schema: OutboundGrantResponseSchema, what: '保存对外授权', lostAs: 'uncertain' })).grant,
    edit: async (id, body) => (await transport.request({ method: 'PUT',
      path: `${OUTBOUND_GRANTS_PATH}/${encodeURIComponent(id)}`, body, schema: OutboundGrantResponseSchema,
      what: '修改对外授权', lostAs: 'uncertain' })).grant,
    revoke: async (id, body) => (await transport.request({ method: 'POST',
      path: `${OUTBOUND_GRANTS_PATH}/${encodeURIComponent(id)}/revoke`, body, schema: OutboundGrantResponseSchema,
      what: '撤销对外授权', lostAs: 'uncertain' })).grant,
  };
}
