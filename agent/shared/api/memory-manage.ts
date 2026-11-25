import { Type, type Static } from 'typebox';
import { MEMORY_CLEANUP_ITEM_KINDS, MEMORY_CLEANUP_STATUSES, MEMORY_LINE_SECTIONS } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };
export const MEMORY_CLEANUPS_PATH = `${API_PREFIX}/memory/cleanups`;
export const MEMORY_LINE_TEXT_MAX = 600;

export const AddMemoryLineRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_TEXT_MAX }),
  section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
}, STRICT);
export type AddMemoryLineRequest = Static<typeof AddMemoryLineRequestSchema>;

export const MoveMemoryLineRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  toDocId: IdSchema,
  section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
}, STRICT);
export type MoveMemoryLineRequest = Static<typeof MoveMemoryLineRequestSchema>;

export const CleanupLineViewSchema = Type.Object({
  id: IdSchema, text: Type.String(), docId: IdSchema, docTitle: Type.String(),
}, STRICT);

export const CleanupItemViewSchema = Type.Object({
  id: Type.String(),
  kind: Type.Enum(MEMORY_CLEANUP_ITEM_KINDS),
  lines: Type.Array(CleanupLineViewSchema),
  toDocId: Type.Union([IdSchema, Type.Null()]),
  toDocTitle: Type.Union([Type.String(), Type.Null()]),
  text: Type.Union([Type.String(), Type.Null()]),
  reason: Type.String(),
  applied: Type.Union([Type.Boolean(), Type.Null()]),
}, STRICT);
export type CleanupItemView = Static<typeof CleanupItemViewSchema>;

export const CleanupViewSchema = Type.Object({
  id: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  status: Type.Enum(MEMORY_CLEANUP_STATUSES),
  error: Type.Union([Type.String(), Type.Null()]),
  items: Type.Array(CleanupItemViewSchema),
  createdAt: IsoTimeSchema,
  finishedAt: Type.Union([IsoTimeSchema, Type.Null()]),
}, STRICT);
export type CleanupView = Static<typeof CleanupViewSchema>;

export const LatestCleanupResponseSchema = Type.Object({
  cleanup: Type.Union([CleanupViewSchema, Type.Null()]),
  overview: Type.Union([Type.Object({ text: Type.String(), at: IsoTimeSchema }, STRICT), Type.Null()]),
}, STRICT);
export type LatestCleanupResponse = Static<typeof LatestCleanupResponseSchema>;

export const StartCleanupRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type StartCleanupRequest = Static<typeof StartCleanupRequestSchema>;

export const ApplyCleanupRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  itemIds: Type.Array(Type.String(), { maxItems: 400 }),
}, STRICT);
export type ApplyCleanupRequest = Static<typeof ApplyCleanupRequestSchema>;

export const ApplyCleanupResponseSchema = Type.Object({
  cleanup: CleanupViewSchema,
  applied: Type.Integer({ minimum: 0 }),
  skipped: Type.Integer({ minimum: 0 }),
  stale: Type.Integer({ minimum: 0 }),
}, STRICT);
export type ApplyCleanupResponse = Static<typeof ApplyCleanupResponseSchema>;

export function memoryLinesPath(docId: string): string {
  return `${API_PREFIX}/memory/docs/${encodeURIComponent(docId)}/lines`;
}
export function memoryLineMovePath(docId: string, lineId: string): string {
  return `${memoryLinesPath(docId)}/${encodeURIComponent(lineId)}/move`;
}
export function memoryCleanupApplyPath(id: string): string {
  return `${MEMORY_CLEANUPS_PATH}/${encodeURIComponent(id)}/apply`;
}
