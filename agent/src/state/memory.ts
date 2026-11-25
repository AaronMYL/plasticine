import {
  MemoryEntryInputSchema,
  MemoryEntryPatchSchema,
  MemoryEntrySchema,
  type MemoryEntry,
  type Page,
} from '../../shared/state.ts';
import { OBJECT_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  text: 'text',
  kind: 'text',
  basis: 'text',
  sourceId: 'text',
  provenance: 'text',
  observationKind: 'text',
  anchor: 'json',
  applicability: 'text',
  stale: 'boolean',
  related: 'json',
  deletedAt: 'text',
};

const DEFAULTS = { stale: false, related: [] };

const UNSETTLED = `kind = 'quote' AND deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM asks q WHERE q.status = 'open' AND q.deferred_at IS NULL AND q.purpose = 'cognition' AND (
    json_extract(q.context, '$.memoryEntryId') = memory_entries.id
      AND json_extract(q.context, '$.version') = memory_entries.version
  )
)`;

const SPEC: StoreSpec<typeof MemoryEntrySchema, typeof MemoryEntryInputSchema, typeof MemoryEntryPatchSchema> = {
  table: 'memory_entries',
  objectType: 'memory_entry',
  schema: MemoryEntrySchema,
  input: MemoryEntryInputSchema,
  patch: MemoryEntryPatchSchema,
  columns: COLUMNS,
  defaults: DEFAULTS,
};

export type MemoryFilter = {
  kind?: MemoryEntry['kind'];
  basis?: MemoryEntry['basis'];
  sourceId?: string;
  stale?: boolean;
};

export function createMemoryStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    create: store.create.bind(store),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    acknowledge: store.acknowledge.bind(store),
    history: store.history.bind(store),
    /** Entries the user has not deleted. */
    list: (filter: MemoryFilter = {}, page: Page = {}): MemoryEntry[] =>
      store.list({ ...filter, deletedAt: null }, page),
    listAll: (filter: MemoryFilter = {}, page: Page = {}): MemoryEntry[] => store.list(filter, page),
    newestFirst(kind: MemoryEntry['kind'], includeArchived: boolean, page: Page,
      filter: { q?: string; observationKind?: string; includeStale?: boolean } = {}): MemoryEntry[] {
      const clauses = ['kind = $kind'];
      const values: Record<string, string> = { kind };
      if (!includeArchived) { clauses.push('deleted_at IS NULL'); }
      if (filter.includeStale === false) { clauses.push('stale = 0'); }
      if (filter.q?.trim()) {
        clauses.push('instr(lower(text), lower($query)) > 0');
        values['query'] = filter.q.trim();
      }
      if (kind === 'interpretation' && filter.observationKind) {
        clauses.push('observation_kind = $observationKind');
        values['observationKind'] = filter.observationKind;
      }
      return store.select(clauses.join(' AND '), values, page, 'created_at DESC, id DESC');
    },
    unsettledQuotes(page: Page): { entries: MemoryEntry[]; total: number } {
      const total = context.db.get(`SELECT COUNT(*) AS total FROM memory_entries WHERE ${UNSETTLED}`);
      return { entries: store.select(UNSETTLED, {}, page, 'created_at DESC, id DESC'),
        total: Number(total?.['total'] ?? 0) };
    },
    /**
     * Every entry that may inform a reply: not deleted, not marked stale. All pages — a context assembled from the
     * first page only would silently miss the user's newer edits.
     */
    inUse: (): MemoryEntry[] =>
      allPages((page) => store.select('deleted_at IS NULL AND stale = 0', {}, page, 'created_at, id')),
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
