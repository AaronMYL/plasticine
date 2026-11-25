import { Type, type Static } from 'typebox';
import { MemoryCleanupPatchSchema, MemoryCleanupSchema, type MemoryCleanup } from '../../shared/state.ts';
import { RECORD_META_COLUMNS } from './codec.ts';
import { ObjectStore, type StoreContext } from './object-store.ts';

const Input = Type.Object({ status: MemoryCleanupSchema.properties.status }, { additionalProperties: false });

export function createMemoryCleanupStore(context: StoreContext) {
  const store = new ObjectStore(context, { table: 'memory_cleanups', schema: MemoryCleanupSchema, input: Input,
    patch: MemoryCleanupPatchSchema,
    columns: { ...RECORD_META_COLUMNS, status: 'text', error: 'text', overview: 'text', items: 'json',
      finishedAt: 'text' },
    defaults: { error: null, overview: null, items: [], finishedAt: null } });
  return {
    get: (id: string): MemoryCleanup | undefined => store.get(id),
    require: (id: string): MemoryCleanup => store.require(id),
    latest: (): MemoryCleanup | undefined => store.select('1', {}, { limit: 1 }, 'created_at DESC, id DESC')[0],
    latestOverview: (): MemoryCleanup | undefined =>
      store.select('overview IS NOT NULL', {}, { limit: 1 }, 'created_at DESC, id DESC')[0],
    create: (input: Static<typeof Input>): MemoryCleanup => store.create(input),
    update: (id: string, version: number, patch: Static<typeof MemoryCleanupPatchSchema>): MemoryCleanup =>
      store.update(id, version, patch),
  };
}
