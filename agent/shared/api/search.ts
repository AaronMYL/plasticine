import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, IdSchema } from './common.ts';
import { TIERS } from './visibility.ts';

export const SEARCH_PATH = `${API_PREFIX}/search`;
export const SEARCH_TYPES = ['notes', 'conversation', 'memory', 'feed', 'bookmarks', 'spaces', 'books'] as const;
export const SearchTypeSchema = Type.Enum(SEARCH_TYPES);
export type SearchType = Static<typeof SearchTypeSchema>;
export const SearchKindSchema = Type.Enum(['note', 'message', 'memory_doc', 'feed_item', 'bookmark', 'space',
  'book']);
export type SearchKind = Static<typeof SearchKindSchema>;

export const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 200 }),
  type: Type.Optional(SearchTypeSchema),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  maxTier: Type.Optional(Type.Enum(TIERS)),
  includeArchived: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type SearchQuery = Static<typeof SearchQuerySchema>;

export const SearchResultSchema = Type.Object({
  kind: SearchKindSchema,
  id: IdSchema,
  title: Type.String(),
  excerpt: Type.String(),
  updatedAt: IsoTimeSchema,
  detail: Type.String(),
  lineKind: Type.Optional(Type.Enum(['main', 'side', 'background'])),
}, { additionalProperties: false });
export type SearchResult = Static<typeof SearchResultSchema>;

export const SearchResponseSchema = Type.Object({
  results: Type.Array(SearchResultSchema),
  total: Type.Integer({ minimum: 0 }),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
  asOf: IsoTimeSchema,
  scanned: Type.Integer({ minimum: 0 }),
  elapsedMs: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });
export type SearchResponse = Static<typeof SearchResponseSchema>;
