import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };
export const LIBRARY_BATCH_PATH = `${API_PREFIX}/library/batch`;
export const LIBRARY_EMPTY_PATH = `${API_PREFIX}/library/trash/empty`;
export const NOTES_BATCH_PATH = `${API_PREFIX}/notes/batch`;
export const NOTES_EMPTY_PATH = `${API_PREFIX}/notes/trash/empty`;
export const BATCH_LIMIT = 1000;
export const BATCH_ACTIONS = ['move', 'trash', 'restore', 'purge'] as const;
export const BATCH_KINDS = ['space', 'book', 'file', 'folder', 'note'] as const;
export const BatchItemSchema = Type.Object({ kind: Type.Enum(BATCH_KINDS), id: Type.String({ minLength: 1 }) }, STRICT);
export type BatchItem = Static<typeof BatchItemSchema>;
const fields = {
  requestId: RequestIdSchema,
  action: Type.Enum(BATCH_ACTIONS),
  destination: Type.Optional(Type.String({ maxLength: 4000 })),
};
export const LibraryBatchRequestSchema = Type.Object({ ...fields,
  items: Type.Array(Type.Object({ kind: Type.Enum(['space', 'book', 'file', 'folder']),
    id: Type.String({ minLength: 1 }) }, STRICT), { minItems: 1, maxItems: BATCH_LIMIT }) }, STRICT);
export const NotesBatchRequestSchema = Type.Object({ ...fields,
  items: Type.Array(Type.Object({ kind: Type.Literal('note'), id: Type.String({ minLength: 1 }) }, STRICT),
    { minItems: 1, maxItems: BATCH_LIMIT }) }, STRICT);
export type LibraryBatchRequest = Static<typeof LibraryBatchRequestSchema>;
export type NotesBatchRequest = Static<typeof NotesBatchRequestSchema>;
export type BatchRequest = LibraryBatchRequest | NotesBatchRequest;
export const EmptyTrashRequestSchema = Type.Object({ requestId: RequestIdSchema,
  expectCount: Type.Integer({ minimum: 0 }) }, STRICT);
export type EmptyTrashRequest = Static<typeof EmptyTrashRequestSchema>;
export const BatchResultSchema = Type.Object({ ...BatchItemSchema.properties,
  title: Type.String(), ok: Type.Boolean(), error: Type.Union([Type.String(), Type.Null()]) }, STRICT);
export type BatchResult = Static<typeof BatchResultSchema>;
export const BatchResponseSchema = Type.Object({ results: Type.Array(BatchResultSchema),
  succeeded: Type.Integer({ minimum: 0 }), failed: Type.Integer({ minimum: 0 }) }, STRICT);
export type BatchResponse = Static<typeof BatchResponseSchema>;
