import { Type, type Static } from 'typebox';
import { MEMORY_DREAM_CHANGE_KINDS } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { MemoryLineSourceSchema } from './memory-topics.ts';

export const MEMORY_SEARCH_PATH = `${API_PREFIX}/memory/search`;
export const MEMORY_DREAMS_PATH = `${API_PREFIX}/memory/dreams`;
export const MEMORY_SEARCH_MAX_HITS = 30;

export const MemorySearchQuerySchema = Type.Object(
  { q: Type.String({ minLength: 1, maxLength: 200 }), archive: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export const MemorySearchHitSchema = Type.Object({
  topicId: IdSchema,
  topicTitle: Type.String({ minLength: 1 }),
  lineId: IdSchema,
  text: Type.String({ minLength: 1 }),
  archivedAt: OrNull(IsoTimeSchema),
});
export type MemorySearchHit = Static<typeof MemorySearchHitSchema>;
export const MemorySearchResponseSchema = Type.Object({ hits: Type.Array(MemorySearchHitSchema) });
export type MemorySearchResponse = Static<typeof MemorySearchResponseSchema>;

export const MemoryDreamChangeViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(MEMORY_DREAM_CHANGE_KINDS),
  text: Type.String({ minLength: 1 }),
  previous: OrNull(Type.String()),
  topicId: OrNull(IdSchema),
  sources: Type.Array(MemoryLineSourceSchema),
  candidates: Type.Array(Type.Object({ text: Type.String({ minLength: 1 }),
    sources: Type.Array(MemoryLineSourceSchema) })),
  undone: Type.Boolean(),
  chosen: OrNull(Type.Integer({ minimum: 0, maximum: 1 })),
  canUndo: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type MemoryDreamChangeView = Static<typeof MemoryDreamChangeViewSchema>;

export const MemoryDreamViewSchema = Type.Object({
  id: IdSchema,
  startedAt: IsoTimeSchema,
  finishedAt: IsoTimeSchema,
  linesRead: Type.Integer({ minimum: 0 }),
  conversationsRead: Type.Integer({ minimum: 0 }),
  changes: Type.Array(MemoryDreamChangeViewSchema),
});
export type MemoryDreamView = Static<typeof MemoryDreamViewSchema>;

export const UndoDreamChangeRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type UndoDreamChangeRequest = Static<typeof UndoDreamChangeRequestSchema>;

export const ChooseDreamChangeRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), choice: Type.Integer({ minimum: 0,
    maximum: 1 }) },
  { additionalProperties: false },
);
export type ChooseDreamChangeRequest = Static<typeof ChooseDreamChangeRequestSchema>;
