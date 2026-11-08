// 信息流的来源（M4）：关注点（每个挂一条探索方向关切）、站内、不要的网站。关掉一个来源只把 level 置成 off，
// 不删行。内置和迁移来的来源带稳定的 ref，再要一次拿回同一行。删掉（第 7 批第 10 条，迁移 0113）也不删行：记下
// removed_at，列表和抓取不再看它；再 ensure 同一个 ref 就把它找回来。get / require 照样拿得到（条目的来源名要用）。

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

const LIVE = 'removed_at IS NULL';

export function createFeedSourceStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);

  function byRef(ref: string): FeedSource | undefined {
    return store.select('ref = $ref', { ref })[0];
  }

  function removed(id: string): boolean {
    const row = context.db.get('SELECT removed_at FROM feed_sources WHERE id = $id', { id });
    return row !== undefined && row['removed_at'] !== null;
  }

  function live(filter: FeedSourceFilter, page: Page): FeedSource[] {
    if (filter.kind === undefined) {
      return store.select(LIVE, {}, page);
    }
    return store.select(`kind = $kind AND ${LIVE}`, { kind: filter.kind }, page);
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
    /** The source with `input.ref`, made the first time it is asked for; a removed one comes back as it was asked. */
    ensure(input: FeedSourceInput & { ref: string }): FeedSource {
      const cleaned = cleanSourceLinks(input);
      return context.db.transaction(() => {
        const found = byRef(cleaned.ref);
        if (found === undefined) {
          return store.create(cleaned);
        }
        if (!removed(found.id)) {
          return found;
        }
        context.db.run('UPDATE feed_sources SET removed_at = NULL WHERE id = $id', { id: found.id });
        return store.update(found.id, found.version, { label: cleaned.label, level: cleaned.level ?? 'normal',
          ...(cleaned.query === undefined ? {} : { query: cleaned.query }) });
      });
    },
    /** 删掉：记下时间、档位关掉（再抓不到它），版本加一。 */
    remove(id: string, version: number): FeedSource {
      return context.db.transaction(() => {
        const source = store.update(id, version, { level: 'off' });
        context.db.run('UPDATE feed_sources SET removed_at = $at WHERE id = $id', { id, at: context.now() });
        return source;
      });
    },
    removed,
    /** 没删的来源（删了的另由 get / require 拿）。 */
    list: (filter: FeedSourceFilter = {}, page: Page = {}): FeedSource[] => live(filter, page),
    all: (filter: FeedSourceFilter = {}): FeedSource[] => allPages((page) => live(filter, page)),
  };
}

export type FeedSourceStore = ReturnType<typeof createFeedSourceStore>;
