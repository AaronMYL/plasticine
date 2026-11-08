// 书签（第 110 条）：只做存取。去重、排在哪、推哪个项目，由 daily/bookmarks.ts 决定。
// 删除只写 deletedAt，行留着（10-26 第 25 条的口径：库里的记录是资产）。

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
    /** 在用的（没删的）全部书签，按排好的先后。 */
    live: (): Bookmark[] => allPages((page) => store.select('deleted_at IS NULL', {}, page, LIVE_ORDER)),
    /** 删过的也在里面（启动核对用）。 */
    all: (): Bookmark[] => allPages((page) => store.select('1 = 1', {}, page, LIVE_ORDER)),
    /** 新加的排在最后：现在最大的 position 加一。 */
    nextPosition: (): number => {
      const row = context.db.get('SELECT max(position) AS top FROM bookmarks', {});
      const top = row?.['top'];
      return typeof top === 'number' ? top + 1 : 0;
    },
  };
}

export type BookmarkStore = ReturnType<typeof createBookmarkStore>;
