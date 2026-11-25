import { Type, type Static } from 'typebox';
import { ActorSchema, IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';
import { DaySchema } from './state-daily.ts';
import { MemoryAnchorSchema, MEMORY_LINE_MAX_CHARS } from './state-memory-docs.ts';

const STRICT = { additionalProperties: false };

export const MEMORY_JOURNAL_KINDS = ['fact', 'decision', 'correction', 'done', 'remembered'] as const;
export type MemoryJournalKind = (typeof MEMORY_JOURNAL_KINDS)[number];
export const MEMORY_JOURNAL_TEXT_MAX_CHARS = 300;
export const MEMORY_JOURNAL_RETENTION_DAYS = 30;

export const MemoryJournalInputSchema = Type.Object(
  {
    day: DaySchema,
    kind: Type.Enum(MEMORY_JOURNAL_KINDS),
    text: Type.String({ minLength: 1, maxLength: MEMORY_JOURNAL_TEXT_MAX_CHARS }),
    anchors: Type.Array(MemoryAnchorSchema, { minItems: 1 }),
    docId: Type.Optional(Nullable(IdSchema)),
    lineId: Type.Optional(Nullable(IdSchema)),
    writtenBy: ActorSchema,
    writtenRef: Type.Optional(Nullable(Type.String())),
  },
  STRICT,
);
export type MemoryJournalInput = Static<typeof MemoryJournalInputSchema>;
export const MemoryJournalEntrySchema = Type.Object({
  id: IdSchema,
  createdAt: IsoTimeSchema,
  ...Type.Required(MemoryJournalInputSchema).properties,
  dreamId: Nullable(IdSchema),
  archivedAt: Nullable(IsoTimeSchema),
  deletedAt: Nullable(IsoTimeSchema),
});
export type MemoryJournalEntry = Static<typeof MemoryJournalEntrySchema>;

export const MEMORY_DREAM_CHANGE_KINDS = ['add', 'replace', 'unsure', 'dead_end'] as const;

export const MemoryDreamCandidateSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
    anchors: Type.Array(MemoryAnchorSchema, { minItems: 1 }),
  },
  STRICT,
);

export const MemoryDreamInputSchema = Type.Object(
  {
    startedAt: IsoTimeSchema,
    linesRead: Type.Integer({ minimum: 0 }),
    conversationsRead: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type MemoryDreamInput = Static<typeof MemoryDreamInputSchema>;
export const MemoryDreamSchema = Type.Object({
  ...RECORD_META,
  ...MemoryDreamInputSchema.properties,
  finishedAt: Nullable(IsoTimeSchema),
});
export type MemoryDream = Static<typeof MemoryDreamSchema>;

export const MemoryDreamChangeInputSchema = Type.Object(
  {
    dreamId: IdSchema,
    kind: Type.Enum(MEMORY_DREAM_CHANGE_KINDS),
    docId: Type.Optional(Nullable(IdSchema)),
    lineId: Type.Optional(Nullable(IdSchema)),
    oldLineId: Type.Optional(Nullable(IdSchema)),
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
    previous: Type.Optional(Nullable(Type.String())),
    candidates: Type.Optional(Type.Array(MemoryDreamCandidateSchema, { maxItems: 2 })),
    anchors: Type.Array(MemoryAnchorSchema),
  },
  STRICT,
);
export type MemoryDreamChangeInput = Static<typeof MemoryDreamChangeInputSchema>;
export const MemoryDreamChangeSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(MemoryDreamChangeInputSchema).properties,
  position: Type.Integer({ minimum: 0 }),
  undoneAt: Nullable(IsoTimeSchema),
  chosen: Nullable(Type.Integer({ minimum: 0, maximum: 1 })),
  resolvedAt: Nullable(IsoTimeSchema),
});
export type MemoryDreamChange = Static<typeof MemoryDreamChangeSchema>;
export const MemoryDreamChangePatchSchema = Type.Partial(Type.Object({
  undoneAt: IsoTimeSchema,
  chosen: Type.Integer({ minimum: 0, maximum: 1 }),
  resolvedAt: IsoTimeSchema,
}), STRICT);
export type MemoryDreamChangePatch = Static<typeof MemoryDreamChangePatchSchema>;
