import { Type, type Static } from 'typebox';
import { HashSchema } from './state-access.ts';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const BOOK_FORMATS = ['epub', 'txt', 'mobi', 'azw3'] as const;
export const BookFormatSchema = Type.Enum(BOOK_FORMATS);
export type BookFormat = Static<typeof BookFormatSchema>;

export const BOOK_TITLE_MAX_CHARS = 300;
export const BOOK_AUTHOR_MAX_CHARS = 200;
export const BOOK_NOTE_MAX_CHARS = 4_000;
export const BOOK_QUOTE_MAX_CHARS = 4_000;
export const BOOK_CONTEXT_CHARS = 32;

export const HIGHLIGHT_COLORS = ['ochre', 'sage', 'slate', 'rose'] as const;
export const HighlightColorSchema = Type.Enum(HIGHLIGHT_COLORS);
export type HighlightColor = Static<typeof HighlightColorSchema>;

export const ANNOTATION_ORIGINS = ['user', 'plasticine'] as const;

export const BookTocEntrySchema = Type.Object(
  {
    title: Type.String(),
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

export const BookProgressInputSchema = Type.Object(
  {
    bookId: IdSchema,
    chapter: Type.Integer({ minimum: 0 }),
    offset: Type.Integer({ minimum: 0 }),
    percent: Type.Number({ minimum: 0, maximum: 1 }),
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
export const BookAnnotationSchema = Type.Object({
  ...OBJECT_META,
  ...BookAnnotationInputSchema.properties,
  deletedAt: Nullable(IsoTimeSchema),
});
export type BookAnnotation = Static<typeof BookAnnotationSchema>;

export const BOOK_INSIGHT_KINDS = ['outline', 'key_points'] as const;
export const BookInsightKindSchema = Type.Enum(BOOK_INSIGHT_KINDS);
export type BookInsightKind = Static<typeof BookInsightKindSchema>;
export const BOOK_INSIGHT_STATUSES = ['generating', 'ready', 'failed'] as const;

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
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    chapter: Type.Integer({ minimum: 0 }),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    summary: Type.String({ maxLength: 600 }),
    points: Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 8 }),
  },
  STRICT,
);
export type BookOutlinePart = Static<typeof BookOutlinePartSchema>;
export const BookOutlineSchema = Type.Object(
  { summary: Type.Optional(Type.String({ maxLength: 400 })),
    chapters: Type.Optional(Type.Array(BookOutlinePartSchema, { maxItems: 5000 })),
    note: Type.String({ maxLength: 400 }), parts: Type.Array(BookOutlinePartSchema, { minItems: 1, maxItems: 200 }) },
  STRICT,
);
export type BookOutline = Static<typeof BookOutlineSchema>;

export const KEY_POINT_BASES = ['quoted', 'inferred'] as const;
export const BookKeyPointSchema = Type.Object(
  {
    category: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
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
    dismissedPointIds: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 60 }),
    sourceSha256: HashSchema,
  }),
  STRICT,
);
export const BookInsightSchema = Type.Object({
  ...OBJECT_META,
  ...BookInsightInputSchema.properties,
  content: Nullable(Type.Unknown()),
  error: Nullable(Type.String()),
  generatedAt: Nullable(IsoTimeSchema),
  dismissedPointIds: Type.Array(Type.String()),
});
export type BookInsight = Static<typeof BookInsightSchema>;
