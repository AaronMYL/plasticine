import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, IdSchema } from './common.ts';
import { TIERS } from './visibility.ts';

export const SEARCH_PATH = `${API_PREFIX}/search`;
// 2026-11-03 第 110 条：书签（标题和存下的正文快照）也查得到。2026-11-05 任务、判断、来源证据、成果删了（成果迁成笔记，
// 跟着笔记查得到）；对话从主线里查，结果的 id 是消息的引用 line:<线>:<seq>。
// 2026-11-07 第 6 条：空间（Plasticine 写的报告、周报、整理稿）。第 2 条（⌘K 全局切换）：图书（书名、作者、批注）。
export const SEARCH_TYPES = ['notes', 'conversation', 'memory', 'feed', 'bookmarks', 'spaces', 'books'] as const;
export const SearchTypeSchema = Type.Enum(SEARCH_TYPES);
export type SearchType = Static<typeof SearchTypeSchema>;
export const SearchKindSchema = Type.Enum(['note', 'message', 'memory_doc', 'agreement', 'term', 'feed_item',
  'bookmark', 'space', 'book']);
export type SearchKind = Static<typeof SearchKindSchema>;

export const SearchQuerySchema = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 200 }),
  type: Type.Optional(SearchTypeSchema),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  // 2026-11-07《优化清单》第 20 条：同一个索引按档位过滤。不给 = 本人界面：全部档位；不含归档的记忆。
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
  /** 对话的结果在哪种线上（主线、旁聊、后台线）：⌘K 点开跳到那条线。别的种类没有。 */
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
