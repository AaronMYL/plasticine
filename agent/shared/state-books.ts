// 图书（用户 2026-11-01 定）：上传的书、阅读进度、高亮与批注、Plasticine 生成的大纲和重点。
// 原文件和转好的章节是 books/ 下的文件，这里只有表里的行。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { HashSchema } from './state-access.ts';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const BOOK_FORMATS = ['epub', 'txt', 'mobi', 'azw3'] as const;
export const BookFormatSchema = Type.Enum(BOOK_FORMATS);
export type BookFormat = Static<typeof BookFormatSchema>;

// 书名、作者来自书里的元数据，个别书会塞进很长的副标题；超过的部分截掉，不拒收整本书。
export const BOOK_TITLE_MAX_CHARS = 300;
export const BOOK_AUTHOR_MAX_CHARS = 200;
// 批注是用户写的一段话；4,000 字够写一页，再长应该去写笔记。
export const BOOK_NOTE_MAX_CHARS = 4_000;
// 一次高亮的原句上限：一整段长文也够，超过时界面请用户分段划。
export const BOOK_QUOTE_MAX_CHARS = 4_000;
// 原句前后各留一小段，换版本或重新解析后靠它重新对上位置。
export const BOOK_CONTEXT_CHARS = 32;

/** 四种高亮色（用户 2026-11-01 定「多色」）：赭黄、灰绿、灰蓝、灰粉，降饱和，只做文字底。 */
export const HIGHLIGHT_COLORS = ['ochre', 'sage', 'slate', 'rose'] as const;
export const HighlightColorSchema = Type.Enum(HIGHLIGHT_COLORS);
export type HighlightColor = Static<typeof HighlightColorSchema>;

/** user：用户自己划的；plasticine：Plasticine 标的重点，用户点「收下」后才变成这里的一行。 */
export const ANNOTATION_ORIGINS = ['user', 'plasticine'] as const;

export const BookTocEntrySchema = Type.Object(
  {
    title: Type.String(),
    // 每章的字数，进度百分比和「本章约几分钟」都从这里算。
    chars: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type BookTocEntry = Static<typeof BookTocEntrySchema>;

export const BookInputSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: BOOK_TITLE_MAX_CHARS }),
    folder: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 200 }))),
    author: Nullable(Type.String({ maxLength: BOOK_AUTHOR_MAX_CHARS })),
    language: Nullable(Type.String({ maxLength: 40 })),
    format: BookFormatSchema,
    fileName: Type.String({ minLength: 1, maxLength: 400 }),
    sourceBytes: Type.Integer({ minimum: 1 }),
    sourceSha256: HashSchema,
    // 封面是 books/<id>/assets/ 里的一张图；没有封面时界面画文字封面。
    coverAsset: Nullable(Type.String({ minLength: 1, maxLength: 100 })),
    toc: Type.Array(BookTocEntrySchema, { minItems: 1 }),
    charCount: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type BookInput = Static<typeof BookInputSchema>;

export const BookPatchSchema = Type.Partial(
  Type.Object({
    title: Type.String({ minLength: 1, maxLength: BOOK_TITLE_MAX_CHARS }),
    folder: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 200 }))),
    author: Nullable(Type.String({ maxLength: BOOK_AUTHOR_MAX_CHARS })),
    lastOpenedAt: Nullable(IsoTimeSchema),
    // 删书只打这个时间，原文件、标注都留着（不删任何现有数据）。
    deletedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export type BookPatch = Static<typeof BookPatchSchema>;

export const BookRecordSchema = Type.Object({
  ...OBJECT_META,
  ...BookInputSchema.properties,
  lastOpenedAt: Nullable(IsoTimeSchema),
  deletedAt: Nullable(IsoTimeSchema),
});
export type BookRecord = Static<typeof BookRecordSchema>;

/** 书里的一个位置：第几章（从 0 起），章内第几个字（UTF-16 下标，和浏览器 textContent 一致）。 */
export const BookPositionSchema = Type.Object(
  {
    chapter: Type.Integer({ minimum: 0 }),
    offset: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type BookPosition = Static<typeof BookPositionSchema>;

export const BookProgressInputSchema = Type.Object(
  {
    bookId: IdSchema,
    chapter: Type.Integer({ minimum: 0 }),
    offset: Type.Integer({ minimum: 0 }),
    percent: Type.Number({ minimum: 0, maximum: 1 }),
    // 「iPhone 上读到第 7 章」：只是给人看的设备名，不做权限判断。
    deviceLabel: Type.String({ maxLength: 80 }),
  },
  STRICT,
);
export type BookProgressInput = Static<typeof BookProgressInputSchema>;
export const BookProgressPatchSchema = Type.Partial(
  Type.Object({
    chapter: Type.Integer({ minimum: 0 }),
    offset: Type.Integer({ minimum: 0 }),
    percent: Type.Number({ minimum: 0, maximum: 1 }),
    deviceLabel: Type.String({ maxLength: 80 }),
  }),
  STRICT,
);
export const BookProgressSchema = Type.Object({ ...OBJECT_META, ...BookProgressInputSchema.properties });
export type BookProgress = Static<typeof BookProgressSchema>;

export const BookAnnotationInputSchema = Type.Object(
  {
    bookId: IdSchema,
    chapter: Type.Integer({ minimum: 0 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 1 }),
    quote: Type.String({ minLength: 1, maxLength: BOOK_QUOTE_MAX_CHARS }),
    prefix: Type.String({ maxLength: BOOK_CONTEXT_CHARS }),
    suffix: Type.String({ maxLength: BOOK_CONTEXT_CHARS }),
    color: HighlightColorSchema,
    // 有批注文字的就是「批注」，没有的就是单纯的高亮。
    note: Nullable(Type.String({ maxLength: BOOK_NOTE_MAX_CHARS })),
    origin: Type.Enum(ANNOTATION_ORIGINS),
    deviceLabel: Nullable(Type.String({ maxLength: 80 })),
  },
  STRICT,
);
export type BookAnnotationInput = Static<typeof BookAnnotationInputSchema>;
export const BookAnnotationPatchSchema = Type.Partial(
  Type.Object({
    color: HighlightColorSchema,
    note: Nullable(Type.String({ maxLength: BOOK_NOTE_MAX_CHARS })),
    deletedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export type BookAnnotationPatch = Static<typeof BookAnnotationPatchSchema>;
export const BookAnnotationSchema = Type.Object({
  ...OBJECT_META,
  ...BookAnnotationInputSchema.properties,
  deletedAt: Nullable(IsoTimeSchema),
});
export type BookAnnotation = Static<typeof BookAnnotationSchema>;

// ---------- Plasticine 生成的大纲与重点 ----------

export const BOOK_INSIGHT_KINDS = ['outline', 'key_points'] as const;
export const BookInsightKindSchema = Type.Enum(BOOK_INSIGHT_KINDS);
export type BookInsightKind = Static<typeof BookInsightKindSchema>;
export const BOOK_INSIGHT_STATUSES = ['generating', 'ready', 'failed'] as const;

/** 能点回原文的一处：章、起止位置、原句（重新解析后靠原句再对上）。 */
export const BookAnchorSchema = Type.Object(
  {
    chapter: Type.Integer({ minimum: 0 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 1 }),
    quote: Type.String({ minLength: 1, maxLength: BOOK_QUOTE_MAX_CHARS }),
  },
  STRICT,
);
export type BookAnchor = Static<typeof BookAnchorSchema>;

export const BookOutlinePartSchema = Type.Object(
  {
    chapter: Type.Integer({ minimum: 0 }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    summary: Type.String({ maxLength: 600 }),
    points: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 }),
  },
  STRICT,
);
export type BookOutlinePart = Static<typeof BookOutlinePartSchema>;
export const BookOutlineSchema = Type.Object(
  { note: Type.String({ maxLength: 400 }), parts: Type.Array(BookOutlinePartSchema, { minItems: 1, maxItems: 200 }) },
  STRICT,
);
export type BookOutline = Static<typeof BookOutlineSchema>;

/** quoted：有原文依据；inferred：推断，没有直接原文，界面照实写出来。 */
export const KEY_POINT_BASES = ['quoted', 'inferred'] as const;
export const BookKeyPointSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 40 }),
    text: Type.String({ minLength: 1, maxLength: 400 }),
    basis: Type.Enum(KEY_POINT_BASES),
    anchors: Type.Array(BookAnchorSchema, { maxItems: 8 }),
  },
  STRICT,
);
export type BookKeyPoint = Static<typeof BookKeyPointSchema>;
export const BookKeyPointsSchema = Type.Object(
  { points: Type.Array(BookKeyPointSchema, { maxItems: 30 }) },
  STRICT,
);
export type BookKeyPoints = Static<typeof BookKeyPointsSchema>;

export const BookInsightInputSchema = Type.Object(
  {
    bookId: IdSchema,
    kind: BookInsightKindSchema,
    status: Type.Enum(BOOK_INSIGHT_STATUSES),
    // 生成时这本书原文件的摘要：书没变就不重做（《图书讨论》：做一次存下来）。
    sourceSha256: HashSchema,
  },
  STRICT,
);
export type BookInsightInput = Static<typeof BookInsightInputSchema>;
export const BookInsightPatchSchema = Type.Partial(
  Type.Object({
    status: Type.Enum(BOOK_INSIGHT_STATUSES),
    content: Nullable(Type.Unknown()),
    error: Nullable(Type.String({ maxLength: 400 })),
    generatedAt: Nullable(IsoTimeSchema),
    // 用户点了「不要」的重点；收下的会变成一条 origin=plasticine 的标注。
    dismissedPointIds: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 60 }),
    sourceSha256: HashSchema,
  }),
  STRICT,
);
export type BookInsightPatch = Static<typeof BookInsightPatchSchema>;
export const BookInsightSchema = Type.Object({
  ...OBJECT_META,
  ...BookInsightInputSchema.properties,
  content: Nullable(Type.Unknown()),
  error: Nullable(Type.String()),
  generatedAt: Nullable(IsoTimeSchema),
  dismissedPointIds: Type.Array(Type.String()),
});
export type BookInsight = Static<typeof BookInsightSchema>;
