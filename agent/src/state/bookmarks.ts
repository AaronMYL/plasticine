import {
  BookmarkInputSchema,
  BookmarkPatchSchema,
  BookmarkSchema,
  type Bookmark,
  type BookmarkInput,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  kind: 'text',
  title: 'text',
  target: 'text',
  projectId: 'text',
  tabs: 'json',
  snapshot: 'text',
  snapshotChars: 'integer',
  origin: 'text',
  feedItemId: 'text',
  position: 'integer',
  deletedAt: 'text',
};

const DEFAULTS = {
  projectId: null,
  tabs: [],
  snapshot: null,
  snapshotChars: 0,
  feedItemId: null,
  deletedAt: null,
};

const SPEC: StoreSpec<typeof BookmarkSchema, typeof BookmarkInputSchema, typeof BookmarkPatchSchema> = {
  table: 'bookmarks',
  searchSource: 'bookmark',
  schema: BookmarkSchema,
  input: BookmarkInputSchema,
  patch: BookmarkPatchSchema,
  columns: COLUMNS,
  defaults: DEFAULTS,
};

const LIVE_ORDER = 'position, created_at, id';

export function createBookmarkStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    create: (input: BookmarkInput, id?: string): Bookmark => store.create(input, undefined,
      id === undefined ? {} : { id }),
    live: (): Bookmark[] => allPages((page) => store.select('deleted_at IS NULL', {}, page, LIVE_ORDER)),
    all: (): Bookmark[] => allPages((page) => store.select('1 = 1', {}, page, LIVE_ORDER)),
    nextPosition: (): number => {
      const row = context.db.get('SELECT max(position) AS top FROM bookmarks', {});
      const top = row?.['top'];
      return typeof top === 'number' ? top + 1 : 0;
    },
  };
}

export type BookmarkStore = ReturnType<typeof createBookmarkStore>;
