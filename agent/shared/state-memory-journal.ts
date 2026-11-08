// 「今天的记录」和「昨晚整理了什么」（《优化清单》第 10、16 条，用户 11-06 定）。
// 白天只记：每轮对话后，后台把这一轮出现的新事实、决定、他的纠正、做成的事各写成一条带出处的短记录，追加进今天的记录；
// 不改主题文档、不合并、不删除。他明说「记住……」的当场写进主题文档，同时在今天的记录里也记一条（remembered）。
// 夜里的做梦（后面一批）读今天的记录整理进主题文档：一次整理 = 一组变更（新加 / 替换 / 拿不准 / 走不通的路），每条可撤销。
// 今天的记录被整理完进归档（archivedAt），30 天后删除（deletedAt）；一律不对外。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { ActorSchema, IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';
import { DaySchema } from './state-daily.ts';
import { MemoryAnchorSchema, MEMORY_LINE_MAX_CHARS } from './state-memory-docs.ts';

const STRICT = { additionalProperties: false };

/** fact 新事实；decision 决定；correction 他的纠正；done 做成的事；remembered 他明说记住、已当场写进主题文档的。 */
export const MEMORY_JOURNAL_KINDS = ['fact', 'decision', 'correction', 'done', 'remembered'] as const;
export type MemoryJournalKind = (typeof MEMORY_JOURNAL_KINDS)[number];
// 一条是一句短记录；整段原话在出处里。
export const MEMORY_JOURNAL_TEXT_MAX_CHARS = 300;
// 整理完进归档的记录留 30 天再删（第 16 条）。
export const MEMORY_JOURNAL_RETENTION_DAYS = 30;

export const MemoryJournalInputSchema = Type.Object(
  {
    /** 「今天」按他的日历日：YYYY-MM-DD。 */
    day: DaySchema,
    kind: Type.Enum(MEMORY_JOURNAL_KINDS),
    text: Type.String({ minLength: 1, maxLength: MEMORY_JOURNAL_TEXT_MAX_CHARS }),
    anchors: Type.Array(MemoryAnchorSchema, { minItems: 1 }),
    /** 和哪份主题文档有关（remembered 是写进的那份）；说不上来为 null。 */
    docId: Type.Optional(Nullable(IdSchema)),
    /** remembered：当场写进主题文档的那一行。 */
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
  /** 被哪一次整理读完、挪进归档。 */
  dreamId: Nullable(IdSchema),
  archivedAt: Nullable(IsoTimeSchema),
  deletedAt: Nullable(IsoTimeSchema),
});
export type MemoryJournalEntry = Static<typeof MemoryJournalEntrySchema>;

/** 一次整理里的一条变更：新加；替换（旧 → 新，带出处）；拿不准（两个候选，等他挑）；走不通的路。 */
export const MEMORY_DREAM_CHANGE_KINDS = ['add', 'replace', 'unsure', 'dead_end'] as const;
export type MemoryDreamChangeKind = (typeof MEMORY_DREAM_CHANGE_KINDS)[number];

export const MemoryDreamCandidateSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
    anchors: Type.Array(MemoryAnchorSchema, { minItems: 1 }),
  },
  STRICT,
);
export type MemoryDreamCandidate = Static<typeof MemoryDreamCandidateSchema>;

export const MemoryDreamInputSchema = Type.Object(
  {
    startedAt: IsoTimeSchema,
    /** 读了几条线、几段对话（页头那句「读了 6 条线、43 段对话」）。 */
    linesRead: Type.Integer({ minimum: 0 }),
    conversationsRead: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type MemoryDreamInput = Static<typeof MemoryDreamInputSchema>;
export const MemoryDreamSchema = Type.Object({
  ...RECORD_META,
  ...MemoryDreamInputSchema.properties,
  /** 整理做完的时间；没做完的不给界面看。 */
  finishedAt: Nullable(IsoTimeSchema),
});
export type MemoryDream = Static<typeof MemoryDreamSchema>;

export const MemoryDreamChangeInputSchema = Type.Object(
  {
    dreamId: IdSchema,
    kind: Type.Enum(MEMORY_DREAM_CHANGE_KINDS),
    docId: Type.Optional(Nullable(IdSchema)),
    /** add / replace：写出来的那一行。 */
    lineId: Type.Optional(Nullable(IdSchema)),
    /** replace：被替换的旧行（进了归档）。 */
    oldLineId: Type.Optional(Nullable(IdSchema)),
    text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
    /** replace：旧说法。 */
    previous: Type.Optional(Nullable(Type.String())),
    /** unsure：两个候选。 */
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
  /** 他撤销了这一条。 */
  undoneAt: Nullable(IsoTimeSchema),
  /** unsure：他挑了第几个候选（0 / 1）和什么时候挑的。 */
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
