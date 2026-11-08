// /v2/memory/search 与 /v2/memory/dreams（《优化清单》第 10、16 条，11-06 定）：记忆页页头的「搜记忆，含归档」，
// 和「昨晚整理了什么」那一页（读最近一次整理、撤销一条、拿不准的挑一个）。整理本身是后面一批的夜里做梦。

import { Type, type Static } from 'typebox';
import { MEMORY_DREAM_CHANGE_KINDS } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { MemoryLineSourceSchema } from './memory-topics.ts';

export const MEMORY_SEARCH_PATH = `${API_PREFIX}/memory/search`;
export const MEMORY_DREAMS_PATH = `${API_PREFIX}/memory/dreams`;
// 一次搜最多回这么多行：页上是一列结果，不是翻页浏览。
export const MEMORY_SEARCH_MAX_HITS = 30;

/** GET /v2/memory/search?q=&archive= —— 默认只搜现行；界面上的搜索框带归档（archive=true）。 */
export const MemorySearchQuerySchema = Type.Object(
  { q: Type.String({ minLength: 1, maxLength: 200 }), archive: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type MemorySearchQuery = Static<typeof MemorySearchQuerySchema>;

export const MemorySearchHitSchema = Type.Object({
  topicId: IdSchema,
  topicTitle: Type.String({ minLength: 1 }),
  lineId: IdSchema,
  text: Type.String({ minLength: 1 }),
  /** 归档里的行：被取代的旧说法或过时的事实，界面标「归档」。 */
  archivedAt: OrNull(IsoTimeSchema),
});
export type MemorySearchHit = Static<typeof MemorySearchHitSchema>;
export const MemorySearchResponseSchema = Type.Object({ hits: Type.Array(MemorySearchHitSchema) });
export type MemorySearchResponse = Static<typeof MemorySearchResponseSchema>;

export const MemoryDreamChangeViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(MEMORY_DREAM_CHANGE_KINDS),
  text: Type.String({ minLength: 1 }),
  /** 替换：旧说法（划掉显示）。 */
  previous: OrNull(Type.String()),
  topicId: OrNull(IdSchema),
  sources: Type.Array(MemoryLineSourceSchema),
  /** 拿不准：两个候选，各带出处。 */
  candidates: Type.Array(Type.Object({ text: Type.String({ minLength: 1 }),
    sources: Type.Array(MemoryLineSourceSchema) })),
  /** 已撤销。 */
  undone: Type.Boolean(),
  /** 拿不准：他挑了第几个。 */
  chosen: OrNull(Type.Integer({ minimum: 0, maximum: 1 })),
  /** 新加、替换且还没撤销、那一行之后没再被改过的，才给「撤销」。 */
  canUndo: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type MemoryDreamChangeView = Static<typeof MemoryDreamChangeViewSchema>;

/** GET /v2/memory/dreams/latest —— 最近一次做完的整理；还没有是 404。 */
export const MemoryDreamViewSchema = Type.Object({
  id: IdSchema,
  startedAt: IsoTimeSchema,
  finishedAt: IsoTimeSchema,
  linesRead: Type.Integer({ minimum: 0 }),
  conversationsRead: Type.Integer({ minimum: 0 }),
  changes: Type.Array(MemoryDreamChangeViewSchema),
});
export type MemoryDreamView = Static<typeof MemoryDreamViewSchema>;

/** POST /v2/memory/dreams/changes/:id/undo —— 撤销一条新加 / 替换：新行删掉，替换的旧行放回来。 */
export const UndoDreamChangeRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type UndoDreamChangeRequest = Static<typeof UndoDreamChangeRequestSchema>;

/** POST /v2/memory/dreams/changes/:id/choose —— 拿不准的挑一个：挑中的写进那篇文档。 */
export const ChooseDreamChangeRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), choice: Type.Integer({ minimum: 0,
    maximum: 1 }) },
  { additionalProperties: false },
);
export type ChooseDreamChangeRequest = Static<typeof ChooseDreamChangeRequestSchema>;
