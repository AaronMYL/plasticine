import { Type, type Static } from 'typebox';
import { MEMORY_BASES, MEMORY_KINDS } from '../state.ts';
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
  history: Type.Array(ChangeRecordViewSchema),
  sourceContext: Type.Optional(OrNull(SourceContextSchema)),
});
export type MemoryEntryDetail = Static<typeof MemoryEntryDetailSchema>;

