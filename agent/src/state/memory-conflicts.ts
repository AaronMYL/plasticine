// 说法冲突的存取（0130，11-11）：每晚整理时记下的几条互相矛盾的现行行，和 Aaron 怎么定的。只存取，谁算冲突、
// 定了以后退休哪几行由脑和记忆接口决定。

import { Type, type Static } from 'typebox';
import { MemoryConflictInputSchema, MemoryConflictPatchSchema, MemoryConflictSchema,
  type MemoryConflict } from '../../shared/state.ts';
import { RECORD_META_COLUMNS } from './codec.ts';
import { allPages, ObjectStore, type StoreContext } from './object-store.ts';

const Input = Type.Object({ ...MemoryConflictInputSchema.properties }, { additionalProperties: false });

export function createMemoryConflictStore(context: StoreContext) {
  const store = new ObjectStore(context, { table: 'memory_conflicts', schema: MemoryConflictSchema, input: Input,
    patch: MemoryConflictPatchSchema,
    columns: { ...RECORD_META_COLUMNS, title: 'text', lineIds: 'json', status: 'text', resolution: 'text',
      keptLineIds: 'json', foundBy: 'text', resolvedAt: 'text' },
    defaults: { status: 'open', resolution: null, keptLineIds: [], foundBy: null, resolvedAt: null } });
  return {
    get: (id: string): MemoryConflict | undefined => store.get(id),
    require: (id: string): MemoryConflict => store.require(id),
    open: (): MemoryConflict[] => allPages((page) => store.select("status = 'open'", {}, page, 'created_at, id')),
    all: (): MemoryConflict[] => allPages((page) => store.select('1', {}, page, 'created_at, id')),
    create: (input: Static<typeof Input>): MemoryConflict => store.create(input),
    update: (id: string, version: number, patch: Static<typeof MemoryConflictPatchSchema>): MemoryConflict =>
      store.update(id, version, patch),
  };
}
