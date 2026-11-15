// /v2/memory/grants（记忆分层，11-15 Aaron 看过设计稿「承诺和授权」）：承诺和授权一页里结构化的那几条。
// 他用话说的（可以直接做、先问你、先停着）和 Plasticine 答应的是记忆文档 memdoc-grants 里的行，走 /v2/memory/topics
// 和 /v2/memory/docs 的读写；对外发送的授权沿用 /v2/outbound/grants；这里只管点过「以后直接做」的那几类（放手）：
// - GET  /v2/memory/grants              放过手的几类
// - POST /v2/memory/grants/loop/revoke  收回一类（之后这类事又会先问）

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };
export const MEMORY_GRANTS_PATH = `${API_PREFIX}/memory/grants`;
export const MEMORY_LOOP_GRANT_REVOKE_PATH = `${MEMORY_GRANTS_PATH}/loop/revoke`;

export const LoopGrantViewSchema = Type.Object({
  id: IdSchema,
  /** 这类事的叫法（「把信息流里的文章存进资料库」）。 */
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
