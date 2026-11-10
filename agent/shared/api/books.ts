// /v2/books：上传一本书（JSON 里带 base64，和对话附件同一种做法）、列出图书馆、读一章、封面和插图、
// 阅读进度、高亮与批注、Plasticine 生成的大纲与重点、在书里找、引用过这本书的讨论、把标注导出成一篇笔记。

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
// 一本书最大 100 MB（带插图的大部头 EPUB 也够）；JSON 里是 base64，请求体按 4/3 放宽。
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
  /** 封面图的地址；null 时界面画文字封面。 */
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

/** 同一个文件再传一次：不新建，回原来那本（duplicate=true），界面直接打开它。 */
export const UploadBookResponseSchema = Type.Object({ book: BookViewSchema, duplicate: Type.Boolean() });
export type UploadBookResponse = Static<typeof UploadBookResponseSchema>;

export const BookChapterResponseSchema = Type.Object({
  bookId: IdSchema,
  index: Type.Integer({ minimum: 0 }),
  title: Type.String(),
  /** 只含允许的标签；插图是 <img data-asset="KEY">，界面换成插图地址。 */
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
    /** 收下 Plasticine 标的一条重点：带上重点的编号，标注记成 origin=plasticine。 */
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
export type DeleteBookRequest = Static<typeof DeleteBookRequestSchema>;

/** PATCH /v2/books/:id：改书名（资料库「最近删除」那一批，11-08）。 */
export const RenameBookRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  title: Type.Optional(Type.String({ minLength: 1, maxLength: BOOK_TITLE_MAX_CHARS })),
  folder: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()])),
}, { additionalProperties: false });
export type RenameBookRequest = Static<typeof RenameBookRequestSchema>;

/** POST /v2/books/:id/restore：从「最近删除」还原，标注跟着回来。 */
export const RestoreBookRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type RestoreBookRequest = Static<typeof RestoreBookRequestSchema>;

export const BookInsightViewSchema = Type.Object({
  kind: Type.Enum(BOOK_INSIGHT_KINDS),
  status: Type.Union([Type.Enum(BOOK_INSIGHT_STATUSES), Type.Literal('none')]),
  outline: Type.Union([BookOutlineSchema, Type.Null()]),
  keyPoints: Type.Union([BookKeyPointsSchema, Type.Null()]),
  dismissedPointIds: Type.Array(Type.String()),
  error: Type.Union([Type.String(), Type.Null()]),
  generatedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** 书在生成之后换过文件：内容还在，界面提示可以重新生成。 */
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
  /** 命中处前后各一小段，命中词在 [before, match, after] 里分开给，界面自己加粗。 */
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

/** 主对话里引用过这本书的一轮：用户那句、它引用的原文、Plasticine 的回答开头。 */
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
