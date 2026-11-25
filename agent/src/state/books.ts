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
    require: (id: string): BookRecord => {
      requireUnpurged(context, 'books', id);
      return store.require(id);
    },
    update: (id: string, version: number, patch: BookPatch): BookRecord => {
      requireUnpurged(context, 'books', id);
      return store.update(id, version, patch);
    },
    create: (input: BookInput, id?: string): BookRecord =>
      store.create(input, undefined, id === undefined ? {} : { id }),
    live: (): BookRecord[] => allPages((page) => store.select(LIVE, {}, page,
      'COALESCE(last_opened_at, created_at) DESC, id')),
    findBySource: (sha256: string): BookRecord | undefined =>
      store.select(`${LIVE} AND source_sha256 = $sha`, { sha: sha256 }, { limit: 1 })[0],
    findDeletedBySource: (sha256: string): BookRecord | undefined =>
      store.select('deleted_at IS NOT NULL AND purged_at IS NULL AND source_sha256 = $sha',
        { sha: sha256 }, { limit: 1 },
        'deleted_at DESC, id')[0],
    deleted: (): BookRecord[] => allPages((page) =>
      store.select('deleted_at IS NOT NULL AND purged_at IS NULL', {}, page,
      'deleted_at DESC, id')),
  };
}

function createProgressRecords(context: StoreContext) {
  const store = new ObjectStore(context, PROGRESS_SPEC);
  return {
    get: store.get.bind(store),
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
