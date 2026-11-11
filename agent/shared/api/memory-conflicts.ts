// /v2/memory/conflicts（11-11 第 11 批第二步）：夜里找出的说法冲突，和 Aaron 选以哪条为准。
// 每条冲突带几行的文字、所在文档、来源、范围；winnerId 是照「你说的 > 推断，范围窄 > 宽，新 > 旧」现在生效的那条。

import { Type, type Static } from 'typebox';
import { MEMORY_CONFLICT_RESOLUTIONS } from '../state.ts';
import { MEMORY_SOURCES } from '../memory-priority.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };
export const MEMORY_CONFLICTS_PATH = `${API_PREFIX}/memory/conflicts`;

export const ConflictLineViewSchema = Type.Object({
  id: IdSchema,
  text: Type.String(),
  docId: IdSchema,
  docTitle: Type.String(),
  source: Type.Enum(MEMORY_SOURCES),
  /** 范围的说法：「全部」「只对研究员」「Cyber Hunter」「周屿」。 */
  scope: Type.String(),
  at: IsoTimeSchema,
}, STRICT);
export type ConflictLineView = Static<typeof ConflictLineViewSchema>;

export const ConflictViewSchema = Type.Object({
  id: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  title: Type.String(),
  lines: Type.Array(ConflictLineViewSchema, { minItems: 2 }),
  winnerId: IdSchema,
  /** 为什么现在以它为准（一句）。 */
  reason: Type.String(),
  createdAt: IsoTimeSchema,
}, STRICT);
export type ConflictView = Static<typeof ConflictViewSchema>;

export const ConflictListResponseSchema = Type.Object({ conflicts: Type.Array(ConflictViewSchema) }, STRICT);
export type ConflictListResponse = Static<typeof ConflictListResponseSchema>;

/** kept：留下 keepLineId，其余进归档；both：都留（再去改范围）；neither：都进归档。 */
export const ResolveConflictRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  resolution: Type.Enum(MEMORY_CONFLICT_RESOLUTIONS),
  keepLineId: Type.Optional(IdSchema),
}, STRICT);
export type ResolveConflictRequest = Static<typeof ResolveConflictRequestSchema>;

export function memoryConflictPath(id: string): string {
  return `${MEMORY_CONFLICTS_PATH}/${encodeURIComponent(id)}`;
}
export { MEMORY_SOURCE_LABELS, MEMORY_SOURCES, type MemorySource } from '../memory-priority.ts';
