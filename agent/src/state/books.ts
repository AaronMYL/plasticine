// 图书的四张表（用户 2026-11-01 定「图书」）：书、阅读进度（每本一行，id 就是书的 id）、高亮与批注、大纲和重点。
// 只管存取，不做业务判断；书的文件在 book-files.ts。删除一律只打 deleted_at。

import {
  BookAnnotationInputSchema,
  BookAnnotationPatchSchema,
  BookAnnotationSchema,
  BookInputSchema,
  BookInsightInputSchema,
  BookInsightPatchSchema,
  BookInsightSchema,
  BookPatchSchema,
  BookProgressInputSchema,
  BookProgressPatchSchema,
  BookProgressSchema,
  BookRecordSchema,
  type BookAnnotation,
  type BookAnnotationInput,
  type BookInsight,
  type BookInsightInput,
  type BookInsightKind,
  type BookInput,
  type BookPatch,
  type BookProgress,
  type BookProgressInput,
  type BookRecord,
} from '../../shared/state.ts';
import type { BookFiles } from './book-files.ts';
import { isPurged, requireUnpurged } from './purged.ts';
import { OBJECT_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const BOOK_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  title: 'text',
  folder: 'text',
  author: 'text',
  language: 'text',
  format: 'text',
  fileName: 'text',
  sourceBytes: 'integer',
  sourceSha256: 'text',
  coverAsset: 'text',
  toc: 'json',
  charCount: 'integer',
  lastOpenedAt: 'text',
  deletedAt: 'text',
};
const BOOK_SPEC: StoreSpec<typeof BookRecordSchema, typeof BookInputSchema, typeof BookPatchSchema> = {
  table: 'books',
  searchSource: 'book',
  schema: BookRecordSchema,
  input: BookInputSchema,
  patch: BookPatchSchema,
  columns: BOOK_COLUMNS,
  defaults: { lastOpenedAt: null, deletedAt: null, folder: null },
};

const PROGRESS_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  bookId: 'text',
  chapter: 'integer',
  offset: 'integer',
  percent: 'real',
  deviceLabel: 'text',
};
const PROGRESS_SPEC: StoreSpec<typeof BookProgressSchema, typeof BookProgressInputSchema,
  typeof BookProgressPatchSchema> = {
  table: 'book_progress',
  schema: BookProgressSchema,
  input: BookProgressInputSchema,
  patch: BookProgressPatchSchema,
  columns: PROGRESS_COLUMNS,
  defaults: {},
};

const ANNOTATION_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  bookId: 'text',
  chapter: 'integer',
  start: 'integer',
  end: 'integer',
  quote: 'text',
  prefix: 'text',
  suffix: 'text',
  color: 'text',
  note: 'text',
  origin: 'text',
  deviceLabel: 'text',
  deletedAt: 'text',
};
const ANNOTATION_SPEC: StoreSpec<typeof BookAnnotationSchema, typeof BookAnnotationInputSchema,
  typeof BookAnnotationPatchSchema> = {
  table: 'book_annotations',
  searchSource: 'book_annotation',
  schema: BookAnnotationSchema,
  input: BookAnnotationInputSchema,
  patch: BookAnnotationPatchSchema,
  columns: ANNOTATION_COLUMNS,
  defaults: { deletedAt: null },
};

const INSIGHT_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  bookId: 'text',
  kind: 'text',
  status: 'text',
  sourceSha256: 'text',
  content: 'json',
  error: 'text',
  generatedAt: 'text',
  dismissedPointIds: 'json',
};
const INSIGHT_SPEC: StoreSpec<typeof BookInsightSchema, typeof BookInsightInputSchema,
  typeof BookInsightPatchSchema> = {
  table: 'book_insights',
  schema: BookInsightSchema,
  input: BookInsightInputSchema,
  patch: BookInsightPatchSchema,
  columns: INSIGHT_COLUMNS,
  defaults: { content: null, error: null, generatedAt: null, dismissedPointIds: [] },
};

const LIVE = 'deleted_at IS NULL';

function createBookRecords(context: StoreContext) {
  const store = new ObjectStore(context, BOOK_SPEC);
  return {
    get: (id: string): BookRecord | undefined => isPurged(context, 'books', id) ? undefined : store.get(id),
    require: (id: string): BookRecord => { requireUnpurged(context, 'books', id); return store.require(id); },
    update: (id: string, version: number, patch: BookPatch): BookRecord => {
      requireUnpurged(context, 'books', id);
      return store.update(id, version, patch);
    },
    /** id 由调用方先定：书的文件按它落盘之后才建这一行。 */
    create: (input: BookInput, id?: string): BookRecord =>
      store.create(input, undefined, id === undefined ? {} : { id }),
    /** 图书馆：最近打开或新加的在前。 */
    live: (): BookRecord[] => allPages((page) => store.select(LIVE, {}, page,
      'COALESCE(last_opened_at, created_at) DESC, id')),
    /** 同一个文件再传一次时找回原来那本（没删的）。 */
    findBySource: (sha256: string): BookRecord | undefined =>
      store.select(`${LIVE} AND source_sha256 = $sha`, { sha: sha256 }, { limit: 1 })[0],
    /** 同一个文件删过的那本（最近删的）：重新上传时还原它，标注才回得来。 */
    findDeletedBySource: (sha256: string): BookRecord | undefined =>
      store.select('deleted_at IS NOT NULL AND purged_at IS NULL AND source_sha256 = $sha', { sha: sha256 }, { limit: 1 },
        'deleted_at DESC, id')[0],
    /** 删掉的（「最近删除」），删的时间新的在前。 */
    deleted: (): BookRecord[] => allPages((page) => store.select('deleted_at IS NOT NULL AND purged_at IS NULL', {}, page,
      'deleted_at DESC, id')),
  };
}

function createProgressRecords(context: StoreContext) {
  const store = new ObjectStore(context, PROGRESS_SPEC);
  return {
    get: store.get.bind(store),
    /** 每本书一行：没有就新建，有就按版本改；版本对不上时抛 version_conflict，由接口层决定怎么处理。 */
    save: (input: BookProgressInput, expectedVersion: number | null): BookProgress => {
      if (expectedVersion === null) {
        return store.create(input, undefined, { id: input.bookId });
      }
      const { chapter, offset, percent, deviceLabel } = input;
      return store.update(input.bookId, expectedVersion, { chapter, offset, percent, deviceLabel });
    },
  };
}

function createAnnotationRecords(context: StoreContext) {
  const store = new ObjectStore(context, ANNOTATION_SPEC);
  return {
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    create: (input: BookAnnotationInput): BookAnnotation => store.create(input),
    /** 一本书的标注，按章、按位置排。 */
    forBook: (bookId: string): BookAnnotation[] => allPages((page) => store.select(`${LIVE} AND book_id = $bookId`,
      { bookId }, page, 'chapter, start, id')),
  };
}

function createInsightRecords(context: StoreContext) {
  const store = new ObjectStore(context, INSIGHT_SPEC);
  return {
    get: store.get.bind(store),
    update: store.update.bind(store),
    create: (input: BookInsightInput): BookInsight => store.create(input),
    find: (bookId: string, kind: BookInsightKind): BookInsight | undefined =>
      store.select('book_id = $bookId AND kind = $kind', { bookId, kind }, { limit: 1 })[0],
    /** 进程重启时还挂着「正在生成」的，说明那一轮已经断了。 */
    generating: (): BookInsight[] => allPages((page) => store.select("status = 'generating'", {}, page)),
  };
}

export function createBookStores(context: StoreContext, files: BookFiles) {
  return {
    books: createBookRecords(context),
    bookProgress: createProgressRecords(context),
    bookAnnotations: createAnnotationRecords(context),
    bookInsights: createInsightRecords(context),
    bookFiles: files,
  };
}

export type BookStores = ReturnType<typeof createBookStores>;
