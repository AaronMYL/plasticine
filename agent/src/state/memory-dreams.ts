import { Type } from 'typebox';
import {
  FORGOTTEN_TEXT,
  IsoTimeSchema,
  MemoryDreamChangeInputSchema,
  MemoryDreamChangePatchSchema,
  MemoryDreamChangeSchema,
  MemoryDreamInputSchema,
  MemoryDreamSchema,
  type MemoryDream,
  type MemoryDreamChange,
  type MemoryDreamChangeInput,
  type MemoryDreamChangePatch,
  type MemoryDreamInput,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const DreamPatchSchema = Type.Object({ finishedAt: IsoTimeSchema }, { additionalProperties: false });

const DREAM_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  startedAt: 'text',
  finishedAt: 'text',
  linesRead: 'integer',
  conversationsRead: 'integer',
};

const DREAM_SPEC: StoreSpec<typeof MemoryDreamSchema, typeof MemoryDreamInputSchema, typeof DreamPatchSchema> = {
  table: 'memory_dreams',
  schema: MemoryDreamSchema,
  input: MemoryDreamInputSchema,
  patch: DreamPatchSchema,
  columns: DREAM_COLUMNS,
  defaults: { finishedAt: null },
};

const CHANGE_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  dreamId: 'text',
  kind: 'text',
  docId: 'text',
  lineId: 'text',
  oldLineId: 'text',
  text: 'text',
  previous: 'text',
  candidates: 'json',
  anchors: 'json',
  position: 'integer',
  undoneAt: 'text',
  chosen: 'integer',
  resolvedAt: 'text',
};

const ChangeCreateSchema = Type.Object({ ...MemoryDreamChangeInputSchema.properties,
  position: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });

const CHANGE_SPEC: StoreSpec<typeof MemoryDreamChangeSchema, typeof ChangeCreateSchema,
  typeof MemoryDreamChangePatchSchema> = {
  table: 'memory_dream_changes',
  schema: MemoryDreamChangeSchema,
  input: ChangeCreateSchema,
  patch: MemoryDreamChangePatchSchema,
  columns: CHANGE_COLUMNS,
  defaults: { docId: null, lineId: null, oldLineId: null, previous: null, candidates: [], undoneAt: null, chosen: null,
    resolvedAt: null },
};

export function createMemoryDreamStore(context: StoreContext) {
  const dreams = new ObjectStore(context, DREAM_SPEC);
  const changes = new ObjectStore(context, CHANGE_SPEC);
  return {
    create: (input: MemoryDreamInput): MemoryDream => dreams.create(input),
    get: dreams.get.bind(dreams),
    finish: (id: string, version: number): MemoryDream => dreams.update(id, version, { finishedAt: context.now() }),
    latest: (): MemoryDream | undefined =>
      dreams.select('finished_at IS NOT NULL', {}, { limit: 1 }, 'finished_at DESC, id DESC')[0],
    addChange(input: MemoryDreamChangeInput): MemoryDreamChange {
      return context.db.transaction(() => {
        const row = context.db.get('SELECT MAX(position) AS top FROM memory_dream_changes WHERE dream_id = $dream',
          { dream: input.dreamId });
        const top = row?.['top'];
        return changes.create({ ...input, position: typeof top === 'number' ? top + 1 : 0 });
      });
    },
    getChange: changes.get.bind(changes),
    requireChange: changes.require.bind(changes),
    updateChange: (id: string, version: number, patch: MemoryDreamChangePatch): MemoryDreamChange =>
      changes.update(id, version, patch),
    forgetLines(lineIds: readonly string[]): void {
      const at = context.now();
      for (const id of lineIds) {
        context.db.run(`UPDATE memory_dream_changes SET text = $text, version = version + 1, updated_at = $at
          WHERE line_id = $id AND text != $text`, { id, text: FORGOTTEN_TEXT, at });
        context.db.run(`UPDATE memory_dream_changes SET previous = NULL, version = version + 1, updated_at = $at
          WHERE old_line_id = $id AND previous IS NOT NULL`, { id, at });
      }
    },
    changes: (dreamId: string): MemoryDreamChange[] => allPages((page) =>
      changes.select('dream_id = $dream', { dream: dreamId }, page, 'position, id')),
  };
}

export type MemoryDreamStore = ReturnType<typeof createMemoryDreamStore>;
