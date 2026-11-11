// 记忆页的改、删、加、挪和全量整理（11-11 第 11 批，Aaron 看过设计稿「Plasticine 记忆改版」）：
// - POST /v2/memory/docs/:docId/lines           加一条（你说的）
// - POST /v2/memory/docs/:docId/lines/:id/move  挪到别的文档（原来那行进归档）
// - 改（PUT …/lines/:id）、删（POST …/lines/:id/retire）沿用 memory-docs 接口
// - POST /v2/memory/cleanups                    开始全量整理；GET /v2/memory/cleanups/latest 看清单和总览
// - POST /v2/memory/cleanups/:id/apply          采用勾选的几条，其余不动

import { Type, type Static } from 'typebox';
import { MEMORY_CLEANUP_ITEM_KINDS, MEMORY_CLEANUP_STATUSES } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };
export const MEMORY_CLEANUPS_PATH = `${API_PREFIX}/memory/cleanups`;
export const MEMORY_LINE_TEXT_MAX = 600;

export const AddMemoryLineRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_TEXT_MAX }),
}, STRICT);
export type AddMemoryLineRequest = Static<typeof AddMemoryLineRequestSchema>;

export const MoveMemoryLineRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  toDocId: IdSchema,
}, STRICT);
export type MoveMemoryLineRequest = Static<typeof MoveMemoryLineRequestSchema>;

export const CleanupLineViewSchema = Type.Object({
  id: IdSchema, text: Type.String(), docId: IdSchema, docTitle: Type.String(),
}, STRICT);
export type CleanupLineView = Static<typeof CleanupLineViewSchema>;

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

/** 最近一次整理（没有为 null）和最近的总览（总览出自哪次整理都行）。 */
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
