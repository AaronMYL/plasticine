// 信息流的来源（M4）：关注点（每个挂一条探索方向关切）、站内、不要的网站。关掉一个来源只把 level 置成 off，
// 不删行。内置和迁移来的来源带稳定的 ref，再要一次拿回同一行。

import {
  FeedSourceInputSchema,
  FeedSourcePatchSchema,
  FeedSourceSchema,
  type CreateOptions,
  type FeedSource,
  type FeedSourceInput,
  type FeedSourcePatch,
  type Page,
} from '../../shared/state.ts';
import { cleanLinkData, cleanSourceLinks } from '../daily/index.ts';
import { OBJECT_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  kind: 'text',
  label: 'text',
  query: 'text',
  queryEdited: 'boolean',
  level: 'text',
  concernId: 'text',
  ref: 'text',
};

const SPEC: StoreSpec<typeof FeedSourceSchema, typeof FeedSourceInputSchema, typeof FeedSourcePatchSchema> = {
  table: 'feed_sources',
  schema: FeedSourceSchema,
  input: FeedSourceInputSchema,
  patch: FeedSourcePatchSchema,
  columns: COLUMNS,
  defaults: { query: null, queryEdited: false, level: 'normal', concernId: null, ref: null },
};

export type FeedSourceFilter = { kind?: FeedSource['kind'] };

export function createFeedSourceStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);

  function byRef(ref: string): FeedSource | undefined {
    return store.select('ref = $ref', { ref })[0];
  }

  return {
    get: store.get.bind(store),
    require: store.require.bind(store),
    update(id: string, version: number, patch: FeedSourcePatch): FeedSource {
      const current = store.require(id);
      const cleaned = cleanSourceLinks({ ...patch, kind: current.kind, label: patch.label ?? current.label });
      const { kind: _kind, ...fields } = cleaned;
      return store.update(id, version, fields);
    },
    byRef,
    create: (input: FeedSourceInput, options: CreateOptions = {}): FeedSource =>
      store.create(cleanSourceLinks(input), undefined, cleanLinkData(options)),
    /** The source with `input.ref`, made the first time it is asked for. */
    ensure(input: FeedSourceInput & { ref: string }): FeedSource {
      const cleaned = cleanSourceLinks(input);
      return context.db.transaction(() => byRef(cleaned.ref) ?? store.create(cleaned));
    },
    list: (filter: FeedSourceFilter = {}, page: Page = {}): FeedSource[] => store.list(filter, page),
    all: (filter: FeedSourceFilter = {}): FeedSource[] => allPages((page) => store.list(filter, page)),
  };
}

export type FeedSourceStore = ReturnType<typeof createFeedSourceStore>;
