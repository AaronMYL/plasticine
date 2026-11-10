import { Type, type Static } from 'typebox';
import { OutboundGrantInputSchema, OutboundGrantPatchSchema, OutboundGrantSchema, OutboundLogSchema }
  from '../outbound.ts';
import { RequestIdSchema } from './common.ts';

export const OUTBOUND_GRANTS_PATH = '/v2/outbound/grants';
export const OUTBOUND_LOG_PATH = '/v2/outbound/log';
export const CreateOutboundGrantRequestSchema = Type.Object({ requestId: RequestIdSchema,
  grant: OutboundGrantInputSchema }, { additionalProperties: false });
export type CreateOutboundGrantRequest = Static<typeof CreateOutboundGrantRequestSchema>;
export const EditOutboundGrantRequestSchema = Type.Object({ requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }), patch: OutboundGrantPatchSchema }, { additionalProperties: false });
export type EditOutboundGrantRequest = Static<typeof EditOutboundGrantRequestSchema>;
export const RevokeOutboundGrantRequestSchema = Type.Object({ requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
export type RevokeOutboundGrantRequest = Static<typeof RevokeOutboundGrantRequestSchema>;
export const OutboundGrantResponseSchema = Type.Object({ grant: OutboundGrantSchema });
export const OutboundGrantListResponseSchema = Type.Object({ grants: Type.Array(OutboundGrantSchema) });
export const OutboundLogListResponseSchema = Type.Object({ entries: Type.Array(OutboundLogSchema) });
export const OutboundLogResponseSchema = Type.Object({ entry: OutboundLogSchema });
export type OutboundGrantListResponse = Static<typeof OutboundGrantListResponseSchema>;
export type OutboundLogListResponse = Static<typeof OutboundLogListResponseSchema>;
