import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };
export const MEMORY_GRANTS_PATH = `${API_PREFIX}/memory/grants`;
export const MEMORY_LOOP_GRANT_REVOKE_PATH = `${MEMORY_GRANTS_PATH}/loop/revoke`;

export const LoopGrantViewSchema = Type.Object({
  id: IdSchema,
  topic: Type.String({ minLength: 1 }),
  grantedAt: IsoTimeSchema,
}, STRICT);
export type LoopGrantView = Static<typeof LoopGrantViewSchema>;

export const MemoryGrantsResponseSchema = Type.Object({ loop: Type.Array(LoopGrantViewSchema) }, STRICT);
export type MemoryGrantsResponse = Static<typeof MemoryGrantsResponseSchema>;

export const RevokeLoopGrantRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  topic: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
export type RevokeLoopGrantRequest = Static<typeof RevokeLoopGrantRequestSchema>;
