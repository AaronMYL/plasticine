import { Type, type Static } from 'typebox';
import {
  BOOK_FORMATS,
  BOOK_INSIGHT_KINDS,
  BOOK_INSIGHT_STATUSES,
  BOOK_NOTE_MAX_CHARS,
  BOOK_QUOTE_MAX_CHARS,
  BOOK_TITLE_MAX_CHARS,
  BOOK_CONTEXT_CHARS,
  ANNOTATION_ORIGINS,
  BookOutlineSchema,
  BookKeyPointsSchema,
  BookTocEntrySchema,
  HighlightColorSchema,
} from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';

export const BOOKS_PATH = `${API_PREFIX}/books`;
export const BOOK_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const BOOK_FILE_EXTENSIONS = ['.epub', '.txt', '.mobi', '.azw3', '.azw'] as const;

export const BookProgressViewSchema = Type.Object({
  chapter: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0 }),
  percent: Type.Number({ minimum: 0, maximum: 1 }),
  deviceLabel: Type.String(),
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type BookProgressView = Static<typeof BookProgressViewSchema>;

export const BookViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  folder: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  author: Type.Union([Type.String(), Type.Null()]),
  format: Type.Enum(BOOK_FORMATS),
  fileName: Type.String(),
  sourceBytes: Type.Integer({ minimum: 1 }),
  coverUrl: Type.Union([Type.String(), Type.Null()]),
  toc: Type.Array(BookTocEntrySchema),
  charCount: Type.Integer({ minimum: 0 }),
  progress: Type.Union([BookProgressViewSchema, Type.Null()]),
  annotationCount: Type.Integer({ minimum: 0 }),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  lastOpenedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  version: Type.Integer({ minimum: 1 }),
});
export type BookView = Static<typeof BookViewSchema>;

export const BookListResponseSchema = Type.Object({ books: Type.Array(BookViewSchema) });
export type BookListResponse = Static<typeof BookListResponseSchema>;

export const UploadBookRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    fileName: Type.String({ minLength: 1, maxLength: 400 }),
    bytes: Type.Integer({ minimum: 1, maximum: BOOK_UPLOAD_MAX_BYTES }),
    sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    content: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type UploadBookRequest = Static<typeof UploadBookRequestSchema>;

export const UploadBookResponseSchema = Type.Object({ book: BookViewSchema, duplicate: Type.Boolean() });
export type UploadBookResponse = Static<typeof UploadBookResponseSchema>;

export const BookChapterResponseSchema = Type.Object({
  bookId: IdSchema,
  index: Type.Integer({ minimum: 0 }),
  title: Type.String(),
  html: Type.String(),
  chars: Type.Integer({ minimum: 0 }),
  assetBaseUrl: Type.String(),
});
export type BookChapterResponse = Static<typeof BookChapterResponseSchema>;

export const SaveBookProgressRequestSchema = Type.Object(
  {
    chapter: Type.Integer({ minimum: 0 }),
    offset: Type.Integer({ minimum: 0 }),
    percent: Type.Number({ minimum: 0, maximum: 1 }),
    deviceLabel: Type.String({ minLength: 1, maxLength: 80 }),
  },
  { additionalProperties: false },
);
export type SaveBookProgressRequest = Static<typeof SaveBookProgressRequestSchema>;

export const BookAnnotationViewSchema = Type.Object({
  id: IdSchema,
  bookId: IdSchema,
  chapter: Type.Integer({ minimum: 0 }),
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 1 }),
  quote: Type.String(),
  prefix: Type.String(),
  suffix: Type.String(),
  color: HighlightColorSchema,
  note: Type.Union([Type.String(), Type.Null()]),
  origin: Type.Enum(ANNOTATION_ORIGINS),
  deviceLabel: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type BookAnnotationView = Static<typeof BookAnnotationViewSchema>;

export const BookAnnotationListResponseSchema = Type.Object({ annotations: Type.Array(BookAnnotationViewSchema) });
export type BookAnnotationListResponse = Static<typeof BookAnnotationListResponseSchema>;

export const CreateBookAnnotationRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    chapter: Type.Integer({ minimum: 0 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 1 }),
    quote: Type.String({ minLength: 1, maxLength: BOOK_QUOTE_MAX_CHARS }),
    prefix: Type.String({ maxLength: BOOK_CONTEXT_CHARS }),
    suffix: Type.String({ maxLength: BOOK_CONTEXT_CHARS }),
    color: HighlightColorSchema,
    note: Type.Optional(Type.Union([Type.String({ maxLength: BOOK_NOTE_MAX_CHARS }), Type.Null()])),
    deviceLabel: Type.Optional(Type.String({ maxLength: 80 })),
    keyPointId: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  },
  { additionalProperties: false },
);
export type CreateBookAnnotationRequest = Static<typeof CreateBookAnnotationRequestSchema>;

export const UpdateBookAnnotationRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    color: Type.Optional(HighlightColorSchema),
    note: Type.Optional(Type.Union([Type.String({ maxLength: BOOK_NOTE_MAX_CHARS }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type UpdateBookAnnotationRequest = Static<typeof UpdateBookAnnotationRequestSchema>;

export const DeleteBookRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });

export const RenameBookRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  title: Type.Optional(Type.String({ minLength: 1, maxLength: BOOK_TITLE_MAX_CHARS })),
  folder: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])),
}, { additionalProperties: false });
export type RenameBookRequest = Static<typeof RenameBookRequestSchema>;

export const RestoreBookRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });

export const BookInsightViewSchema = Type.Object({
  spaceId: Type.Optional(Type.Union([IdSchema, Type.Null()])),
  kind: Type.Enum(BOOK_INSIGHT_KINDS),
  status: Type.Union([Type.Enum(BOOK_INSIGHT_STATUSES), Type.Literal('none')]),
  outline: Type.Union([BookOutlineSchema, Type.Null()]),
  keyPoints: Type.Union([BookKeyPointsSchema, Type.Null()]),
  dismissedPointIds: Type.Array(Type.String()),
  error: Type.Union([Type.String(), Type.Null()]),
  generatedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  stale: Type.Boolean(),
});
export type BookInsightView = Static<typeof BookInsightViewSchema>;

export const GenerateBookInsightRequestSchema = Type.Object(
  { requestId: RequestIdSchema, kind: Type.Enum(BOOK_INSIGHT_KINDS), force: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type GenerateBookInsightRequest = Static<typeof GenerateBookInsightRequestSchema>;

export const DismissKeyPointRequestSchema = Type.Object(
  { requestId: RequestIdSchema, pointId: Type.String({ minLength: 1, maxLength: 40 }) },
  { additionalProperties: false },
);
export type DismissKeyPointRequest = Static<typeof DismissKeyPointRequestSchema>;

export const BOOK_SEARCH_MAX_HITS = 50;
export const BookSearchHitSchema = Type.Object({
  chapter: Type.Integer({ minimum: 0 }),
  chapterTitle: Type.String(),
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 1 }),
  before: Type.String(),
  match: Type.String(),
  after: Type.String(),
});
export type BookSearchHit = Static<typeof BookSearchHitSchema>;
export const BookSearchResponseSchema = Type.Object({
  hits: Type.Array(BookSearchHitSchema),
  truncated: Type.Boolean(),
});
export type BookSearchResponse = Static<typeof BookSearchResponseSchema>;

export const BookDiscussionSchema = Type.Object({
  messageId: IdSchema,
  at: IsoTimeSchema,
  question: Type.String(),
  quoteLabel: Type.String(),
  chapter: Type.Integer({ minimum: 0 }),
  start: Type.Integer({ minimum: 0 }),
  answer: Type.Union([Type.String(), Type.Null()]),
  answerMessageId: Type.Union([IdSchema, Type.Null()]),
});
export type BookDiscussion = Static<typeof BookDiscussionSchema>;
export const BookDiscussionListResponseSchema = Type.Object({ discussions: Type.Array(BookDiscussionSchema) });
export type BookDiscussionListResponse = Static<typeof BookDiscussionListResponseSchema>;

export const ExportBookNotesRequestSchema = Type.Object(
  { requestId: RequestIdSchema }, { additionalProperties: false },
);
export const ExportBookNotesResponseSchema = Type.Object({ noteId: IdSchema, annotationCount: Type.Integer() });
export type ExportBookNotesResponse = Static<typeof ExportBookNotesResponseSchema>;
