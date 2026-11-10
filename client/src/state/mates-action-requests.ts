import { Type } from 'typebox';
import { CreateMateRequestSchema, UpdateMateRequestSchema, CreateMateGroupRequestSchema,
  UpdateMateGroupRequestSchema, MateHandoffRequestSchema, LegacyChatConvertRequestSchema } from '../api/shared.ts';

export const MATES_ACTION_REQUEST_SCHEMAS = [
  Type.Object({ kind: Type.Literal('mate_create'), body: CreateMateRequestSchema }),
  Type.Object({ kind: Type.Literal('mate_update'), mateId: Type.String(), body: UpdateMateRequestSchema }),
  Type.Object({ kind: Type.Literal('mate_group_create'), body: CreateMateGroupRequestSchema }),
  Type.Object({ kind: Type.Literal('mate_group_update'), groupId: Type.String(), body: UpdateMateGroupRequestSchema }),
  Type.Object({ kind: Type.Literal('mate_handoff'), body: MateHandoffRequestSchema }),
  Type.Object({ kind: Type.Literal('mate_legacy_convert'), body: LegacyChatConvertRequestSchema }),
] as const;
