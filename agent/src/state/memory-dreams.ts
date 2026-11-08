// 「昨晚整理了什么」的存取（《优化清单》第 10、16 条，11-06 定）：一次整理 = 一组变更（新加 / 替换 / 拿不准 / 走不通的路）。
// 这一批只建表和读取；整理逻辑（夜里的做梦）是后面一批，它经 create / addChange / finish 写。撤销、挑候选只改那一条的标记，
// 对文档的改动由脑在同一个事务里做。

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
    /** 最近一次做完的整理；还没有就是 undefined（界面不出现入口）。 */
    latest: (): MemoryDream | undefined =>
      dreams.select('finished_at IS NOT NULL', {}, { limit: 1 }, 'finished_at DESC, id DESC')[0],
    /** 一条变更，排在这次整理的最后。 */
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
    /** 撤销、挑候选：带 version，过时就是冲突。 */
    updateChange: (id: string, version: number, patch: MemoryDreamChangePatch): MemoryDreamChange =>
      changes.update(id, version, patch),
    /**
     * 他说「忘掉」的行删掉以后（11-07 他定真删）：写出那一行的变更，原文换成 FORGOTTEN_TEXT；替换掉那一行的变更，
     * 「旧说法」抹掉。变更本身留着（这一晚整理过什么），讲的是什么不再留。调用方在 erasing 事务里调。
     */
    forgetLines(lineIds: readonly string[]): void {
      const at = context.now();
      for (const id of lineIds) {
        context.db.run(`UPDATE memory_dream_changes SET text = $text, version = version + 1, updated_at = $at
          WHERE line_id = $id AND text != $text`, { id, text: FORGOTTEN_TEXT, at });
        context.db.run(`UPDATE memory_dream_changes SET previous = NULL, version = version + 1, updated_at = $at
          WHERE old_line_id = $id AND previous IS NOT NULL`, { id, at });
      }
    },
    /** 一次整理的全部变更，按次序。 */
    changes: (dreamId: string): MemoryDreamChange[] => allPages((page) =>
      changes.select('dream_id = $dream', { dream: dreamId }, page, 'position, id')),
  };
}

export type MemoryDreamStore = ReturnType<typeof createMemoryDreamStore>;
