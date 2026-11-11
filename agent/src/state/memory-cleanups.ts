// 全量整理的存取（0132，11-11）：一次整理一行，清单和总览在 JSON 里。只存取，清单怎么来、怎么采用由脑决定。

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
    /** 最近一次（不管做完没有）。 */
    latest: (): MemoryCleanup | undefined => store.select('1', {}, { limit: 1 }, 'created_at DESC, id DESC')[0],
    /** 最近一次写了总览的。 */
    latestOverview: (): MemoryCleanup | undefined =>
      store.select('overview IS NOT NULL', {}, { limit: 1 }, 'created_at DESC, id DESC')[0],
    create: (input: Static<typeof Input>): MemoryCleanup => store.create(input),
    update: (id: string, version: number, patch: Static<typeof MemoryCleanupPatchSchema>): MemoryCleanup =>
      store.update(id, version, patch),
  };
}
