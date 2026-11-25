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
  reason: Type.String(),
  createdAt: IsoTimeSchema,
}, STRICT);
export type ConflictView = Static<typeof ConflictViewSchema>;

export const ConflictListResponseSchema = Type.Object({ conflicts: Type.Array(ConflictViewSchema) }, STRICT);
export type ConflictListResponse = Static<typeof ConflictListResponseSchema>;

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
