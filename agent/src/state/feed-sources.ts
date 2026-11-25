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
import { checkLinkData, checkSourceLinks } from '../daily/index.ts';
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
      const cleaned = checkSourceLinks({ ...patch, kind: current.kind, label: patch.label ?? current.label });
      const { kind: _kind, ...fields } = cleaned;
      return store.update(id, version, fields);
    },
    byRef,
    create: (input: FeedSourceInput, options: CreateOptions = {}): FeedSource =>
      store.create(checkSourceLinks(input), undefined, checkLinkData(options)),
    /** The source with `input.ref`, made the first time it is asked for; a removed one comes back as it was asked. */
    ensure(input: FeedSourceInput & { ref: string }): FeedSource {
      const cleaned = checkSourceLinks(input);
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
    remove(id: string, version: number): FeedSource {
      return context.db.transaction(() => {
        const source = store.update(id, version, { level: 'off' });
        context.db.run('UPDATE feed_sources SET removed_at = $at WHERE id = $id', { id, at: context.now() });
        return source;
      });
    },
    removed,
    list: (filter: FeedSourceFilter = {}, page: Page = {}): FeedSource[] => live(filter, page),
    all: (filter: FeedSourceFilter = {}): FeedSource[] => allPages((page) => live(filter, page)),
  };
}

export type FeedSourceStore = ReturnType<typeof createFeedSourceStore>;
