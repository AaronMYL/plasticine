// /v2/memory：旧记忆条目（memory_entries，原话 / 解释）的只读视图——三栏第一页、一栏往后翻、一条和它的来路与
// ≠ 标记。2026-11-03 起记忆页只有主题文档、约定、判断、词表，改、删、新建旧条目的接口都删了（旧表数据不删，
// 后台一次性整理进主题文档）；这些读接口留给引用里的原话出处、≠ 标记和迁移。

import { Type, type Static } from 'typebox';
import { MEMORY_BASES, MEMORY_KINDS } from '../state.ts';
import { AgreementListResponseSchema } from './agreements.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema } from './common.ts';
import {
  ChangeRecordViewSchema,
  NextOffsetSchema,
  OrNull,
  PageLimitSchema,
  SourceViewSchema,
  SourceContextSchema,
} from './lineage.ts';

export const MEMORY_PATH = `${API_PREFIX}/memory`;
export const MEMORY_ENTRIES_PATH = `${MEMORY_PATH}/entries`;

// Long enough for a paragraph of the user's own words; the notes are where longer text lives.
export const MEMORY_TEXT_MAX_CHARS = 4_000;

export const MemoryEntryViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(MEMORY_KINDS),
  text: Type.String(),
  basis: Type.Enum(MEMORY_BASES),
  observationKind: OrNull(Type.String()),
  provenance: Type.String(),
  applicability: OrNull(Type.String()),
  stale: Type.Boolean(),
  anchor: OrNull(Type.Object({ kind: Type.String(), ref: Type.String() })),
  related: Type.Array(Type.Object({ type: Type.String(), id: Type.String() })),
  source: OrNull(SourceViewSchema),
  archivedAt: OrNull(IsoTimeSchema),
  migrated: Type.Boolean(),
  /** Migrated and not yet touched by the user: shown as 「迁移来的、待你确认」. */
  awaitingConfirmation: Type.Boolean(),
  openDisagreementId: OrNull(IdSchema),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type MemoryEntryView = Static<typeof MemoryEntryViewSchema>;

export const MemoryColumnSchema = Type.Object({
  entries: Type.Array(MemoryEntryViewSchema),
  nextOffset: NextOffsetSchema,
  total: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type MemoryColumn = Static<typeof MemoryColumnSchema>;

export const MemoryFilterFields = {
  q: Type.Optional(Type.String({ maxLength: 1000 })),
  observationKind: Type.Optional(Type.String({ maxLength: 100 })),
  includeStale: Type.Optional(Type.Boolean()),
};

/** GET /v2/memory?limit=&includeArchived= — the first page of each column in one request. */
export const MemoryBoardQuerySchema = Type.Object(
  { limit: Type.Optional(PageLimitSchema), includeArchived: Type.Optional(Type.Boolean()), ...MemoryFilterFields },
  { additionalProperties: false },
);
export type MemoryBoardQuery = Static<typeof MemoryBoardQuerySchema>;

export const MemoryBoardResponseSchema = Type.Object({
  quotes: MemoryColumnSchema,
  interpretations: MemoryColumnSchema,
  agreements: AgreementListResponseSchema,
});
export type MemoryBoardResponse = Static<typeof MemoryBoardResponseSchema>;

/** GET /v2/memory/entries?kind=&limit=&offset=&includeArchived= — later pages of one column, newest first. */
export const MemoryEntriesQuerySchema = Type.Object(
  {
    kind: Type.Enum(MEMORY_KINDS),
    limit: Type.Optional(PageLimitSchema),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    includeArchived: Type.Optional(Type.Boolean()),
    unsettledOnly: Type.Optional(Type.Boolean()),
    ...MemoryFilterFields,
  },
  { additionalProperties: false },
);
export type MemoryEntriesQuery = Static<typeof MemoryEntriesQuerySchema>;

/** GET /v2/memory/entries/:id */
export const MemoryEntryDetailSchema = Type.Object({
  entry: MemoryEntryViewSchema,
  /** 用户编辑记录: every change, oldest first. */
  history: Type.Array(ChangeRecordViewSchema),
  sourceContext: Type.Optional(OrNull(SourceContextSchema)),
});
export type MemoryEntryDetail = Static<typeof MemoryEntryDetailSchema>;

