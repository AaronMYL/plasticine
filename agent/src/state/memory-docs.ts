// 记忆文档的存取（docs/specs/memory-docs.md）：文档、行、只追加的事件。只做存取和两条存储上的规矩：
// 行除了退休不原地改写；confirmed_inference 行只能由一条带设备确认的已确认推断写成（模型和普通写入写不出来）。
// 他说「忘掉」的行真的从库里删掉（11-07 他定），这是行唯一会被删的时候。什么时候加、改、合并哪一行，由脑决定。

import {
  MemoryDocEventInputSchema,
  MemoryDocEventSchema,
  MemoryDocInputSchema,
  MemoryDocPatchSchema,
  MemoryDocSchema,
  MemoryLineInputSchema,
  MemoryLinePatchSchema,
  MemoryLineSchema,
  MEMORY_DOC_CHAR_LIMIT,
  archivesOnRetire,
  type CreateOptions,
  type MemoryDoc,
  type MemoryDocEvent,
  type MemoryDocEventInput,
  type MemoryDocEventKind,
  type MemoryDocInput,
  type MemoryLine,
  type MemoryLineInput,
  type MemoryLineRetireReason,
} from '../../shared/state.ts';
import { checked, encodeRow, OBJECT_META_COLUMNS, readRow, type ColumnMap } from './codec.ts';
import { fromSqliteError, StateError } from './errors.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const DOC_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  kind: 'text',
  title: 'text',
  summary: 'text',
  projectId: 'text',
  charLimit: 'integer',
  createdBy: 'text',
  retiredAt: 'text',
};

const DOC_SPEC: StoreSpec<typeof MemoryDocSchema, typeof MemoryDocInputSchema, typeof MemoryDocPatchSchema> = {
  table: 'memory_docs',
  searchSource: 'memory_doc',
  schema: MemoryDocSchema,
  input: MemoryDocInputSchema,
  patch: MemoryDocPatchSchema,
  columns: DOC_COLUMNS,
  defaults: { projectId: null, charLimit: MEMORY_DOC_CHAR_LIMIT, retiredAt: null },
};

const LINE_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  docId: 'text',
  section: 'text',
  text: 'text',
  basis: 'text',
  anchors: 'json',
  previous: 'text',
  supersedes: 'json',
  inferenceId: 'text',
  position: 'integer',
  writtenBy: 'text',
  writtenRef: 'text',
  retiredAt: 'text',
  retiredReason: 'text',
  archivedAt: 'text',
  deletedAt: 'text',
};

const LINE_SPEC: StoreSpec<typeof MemoryLineSchema, typeof MemoryLineInputSchema, typeof MemoryLinePatchSchema> = {
  table: 'memory_doc_lines',
  searchSource: 'memory_line',
  schema: MemoryLineSchema,
  input: MemoryLineInputSchema,
  patch: MemoryLinePatchSchema,
  columns: LINE_COLUMNS,
  defaults: { section: 'note', previous: null, supersedes: [], inferenceId: null, writtenRef: null, retiredAt: null,
    retiredReason: null, archivedAt: null, deletedAt: null },
};

const EVENT_COLUMNS: ColumnMap = {
  id: 'text',
  docId: 'text',
  lineId: 'text',
  kind: 'text',
  actor: 'text',
  actorRef: 'text',
  detail: 'json',
  createdAt: 'text',
};

const EVENT_SQL = `INSERT INTO memory_doc_events (id, doc_id, line_id, kind, actor, actor_ref, detail, created_at)
  VALUES ($id, $doc_id, $line_id, $kind, $actor, $actor_ref, $detail, $created_at)`;

const LIVE = 'doc_id = $doc_id AND retired_at IS NULL';
// 归档：被取代、过时的行（第 16 条）；删除了的不算。
const ARCHIVED = 'archived_at IS NOT NULL AND deleted_at IS NULL';
const ORDER = 'position, created_at, id';

function createDocStore(context: StoreContext) {
  const store = new ObjectStore(context, DOC_SPEC);
  return {
    create: (input: MemoryDocInput, options: CreateOptions = {}): MemoryDoc => store.create(input, undefined, options),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    /** 在用的文档（没退休的），建的先后排；界面和上下文里的顺序由调用方定。 */
    live: (): MemoryDoc[] => allPages((page) => store.select('retired_at IS NULL', {}, page)),
    forProject: (projectId: string): MemoryDoc | undefined =>
      store.select('project_id = $project_id', { project_id: projectId }, { limit: 1 })[0],
  };
}

/** 确认推断写成行之前查的那一条：已确认，并且带着确认它的设备。 */
function requireConfirmedInference(context: StoreContext, inferenceId: string | null | undefined): void {
  if (inferenceId === null || inferenceId === undefined) {
    throw new StateError('confirmation_required', 'confirmed_inference 行要指向用户确认过的那条推断');
  }
  const sql = `SELECT status, confirmed_by_device_at FROM memory_inferences WHERE id = $id`;
  const row = context.db.get(sql, { id: inferenceId });
  if (row?.['status'] !== 'confirmed' || row['confirmed_by_device_at'] === null) {
    throw new StateError('confirmation_required', '这条推断还没有经用户在设备上确认，不能写成文档里的行');
  }
}

/**
 * 接替被删那一行的行（supersedes 里有它）存着它的原文作「之前：…」：抹掉，版本加一（界面上那一行变了）。
 * 一起删的行不用管。
 */
function clearPrevious(context: StoreContext, id: string, erased: readonly string[]): void {
  const successors = context.db.all(`SELECT id FROM memory_doc_lines WHERE previous IS NOT NULL
    AND EXISTS (SELECT 1 FROM json_each(memory_doc_lines.supersedes) WHERE value = $id)`, { id });
  for (const row of successors) {
    const successor = String(row['id']);
    if (!erased.includes(successor)) {
      context.db.run(`UPDATE memory_doc_lines SET previous = NULL, version = version + 1, updated_at = $at
        WHERE id = $id`, { id: successor, at: context.now() });
    }
  }
}

function createLineStore(context: StoreContext) {
  const store = new ObjectStore(context, LINE_SPEC);
  const nextPosition = (docId: string): number => {
    const row = context.db.get('SELECT MAX(position) AS top FROM memory_doc_lines WHERE doc_id = $doc_id',
      { doc_id: docId });
    const top = row?.['top'];
    return typeof top === 'number' ? top + 1 : 0;
  };
  return {
    /** 加一行；没给位置就排在这份文档最后。 */
    add(input: MemoryLineInput, options: CreateOptions = {}): MemoryLine {
      return context.db.transaction(() => {
        if (input.basis === 'confirmed_inference') {
          requireConfirmedInference(context, input.inferenceId);
        }
        const position = input.position ?? nextPosition(input.docId);
        return store.create({ ...input, position }, undefined, options);
      });
    },
    get: store.get.bind(store),
    require: store.require.bind(store),
    /**
     * 行只在退休时改；已经退休的再退休一次是冲突（迟到的写不能改掉用户已经做的事）。退休同时归位（第 16 条）：
     * 他要忘掉的（forgotten）记删除，其余进归档。
     */
    retire(id: string, version: number, reason: MemoryLineRetireReason): MemoryLine {
      const current = store.require(id);
      if (current.retiredAt !== null) {
        throw new StateError('version_conflict', `这一行已经退休（${current.retiredReason ?? ''}）`,
          { currentVersion: current.version });
      }
      const at = context.now();
      const layer = archivesOnRetire(reason) ? { archivedAt: at } : { deletedAt: at };
      return store.update(id, version, { retiredAt: at, retiredReason: reason, ...layer });
    },
    /**
     * 他说「忘掉」（删前出过确认卡）：这几行不管在现行还是归档，都从库里真的删掉（11-07 他定），全文索引里的条目同一事务
     * 删掉；接替它们的行上存的「之前：…」也抹掉。删掉的内容用零覆盖、索引分段合并一遍，库文件里不留原文。
     * 返回删之前的样子（调用方按它找今天记录里同一件事）。没有的行报找不到，整批不删。
     */
    forget(ids: readonly string[]): MemoryLine[] {
      const unique = [...new Set(ids)];
      return context.db.erasing(() => {
        const lines = unique.map((id) => store.require(id));
        for (const line of lines) {
          clearPrevious(context, line.id, unique);
          context.db.run('DELETE FROM memory_doc_lines WHERE id = $id', { id: line.id });
          context.index?.changed(LINE_SPEC.searchSource ?? 'memory_line', line.id);
        }
        context.index?.purge();
        return lines;
      });
    },
    /** 一份文档在用的行，按文档里的次序。 */
    live: (docId: string): MemoryLine[] => allPages((page) => store.select(LIVE, { doc_id: docId }, page, ORDER)),
    /** 退休了、还没删的行（= 这份文档的归档），最近退休的在前。 */
    retired: (docId: string): MemoryLine[] => allPages((page) =>
      store.select('doc_id = $doc_id AND retired_at IS NOT NULL AND deleted_at IS NULL', { doc_id: docId }, page,
        'retired_at DESC, id')),
    /** 一份文档的归档，最近归档的在前。 */
    archived: (docId: string): MemoryLine[] => allPages((page) =>
      store.select(`doc_id = $doc_id AND ${ARCHIVED}`, { doc_id: docId }, page, 'archived_at DESC, id')),
    /** 所有文档的归档（「以前怎么定的」搜它）。 */
    allArchived: (): MemoryLine[] => allPages((page) =>
      store.select(ARCHIVED, {}, page, 'archived_at DESC, id')),
    /**
     * 一份文档里由这几次写入（整理作业、对话轮的 run）写出的行，在用的和退休的都算，按写的先后（第 4 批：回复下面的
     * 「记下了」按它找这一轮写进「怎么替你做事」的规矩）。
     */
    writtenBy(docId: string, refs: readonly string[]): MemoryLine[] {
      if (refs.length === 0) {
        return [];
      }
      const params: Record<string, string> = { doc_id: docId };
      refs.forEach((ref, index) => {
        params[`ref${index}`] = ref;
      });
      const list = refs.map((_, index) => `$ref${index}`).join(', ');
      return allPages((page) => store.select(`doc_id = $doc_id AND written_ref IN (${list})`, params, page));
    },
    /** 所有在用文档里在用的行（搜索用）。 */
    allLive: (): MemoryLine[] => allPages((page) => store.select(`retired_at IS NULL AND doc_id IN
      (SELECT id FROM memory_docs WHERE retired_at IS NULL)`, {}, page, 'doc_id, position, created_at, id')),
    /** 在用的行数和字数（SQLite 的 length 按字符数）。 */
    size(docId: string): { lines: number; chars: number } {
      const row = context.db.get(`SELECT COUNT(*) AS lines, COALESCE(SUM(length(text)), 0) AS chars
        FROM memory_doc_lines WHERE ${LIVE}`, { doc_id: docId });
      return { lines: Number(row?.['lines'] ?? 0), chars: Number(row?.['chars'] ?? 0) };
    },
  };
}

function createEventStore(context: StoreContext) {
  return {
    add(input: MemoryDocEventInput): MemoryDocEvent {
      const values = checked(MemoryDocEventInputSchema, input, 'invalid_input', '写 memory_doc_events');
      const event = { ...values, id: context.newId(), createdAt: context.now() };
      try {
        context.db.run(EVENT_SQL, encodeRow(EVENT_COLUMNS, event));
      } catch (error) {
        throw fromSqliteError(error, '写 memory_doc_events');
      }
      return checked(MemoryDocEventSchema, event, 'corrupt_record', 'memory_doc_events 写入的一行');
    },
    /** 某类事件从 `since` 起有几条（度量线）。 */
    count(kind: MemoryDocEventKind, since: string): number {
      const row = context.db.get(`SELECT COUNT(*) AS n FROM memory_doc_events
        WHERE kind = $kind AND created_at >= $since`, { kind, since });
      return Number(row?.['n'] ?? 0);
    },
    /** lines_used 事件里一共提到了几行（同一行在两次回复里各算一次）。 */
    usedLines(since: string): number {
      const row = context.db.get(`SELECT COALESCE(SUM(json_array_length(detail, '$.lineIds')), 0) AS n
        FROM memory_doc_events WHERE kind = 'lines_used' AND created_at >= $since`, { since });
      return Number(row?.['n'] ?? 0);
    },
    /** 某类事件里 detail 的一个字段等于某个值的（先后排）；一次性整理靠它判断清单是不是已经落过库。 */
    withDetail(kind: MemoryDocEventKind, field: string, value: string): MemoryDocEvent[] {
      const sql = `SELECT * FROM memory_doc_events WHERE kind = $kind AND json_extract(detail, $path) = $value
        ORDER BY created_at, id`;
      return context.db.all(sql, { kind, path: `$.${field}`, value })
        .map((row) => readRow(MemoryDocEventSchema, EVENT_COLUMNS, row, 'memory_doc_events'));
    },
    /** Soul 的节分类附在事件上；同毫秒内按写入顺序取最后一次。 */
    soulSection(lineId: string): string | undefined {
      const row = context.db.get(`SELECT json_extract(detail, '$.soulSection') AS section
        FROM memory_doc_events WHERE line_id = $line_id AND json_type(detail, '$.soulSection') = 'text'
        ORDER BY rowid DESC LIMIT 1`, { line_id: lineId });
      return typeof row?.['section'] === 'string' ? row['section'] : undefined;
    },
    /** 最近的在前。 */
    recent(docId: string, limit: number): MemoryDocEvent[] {
      const sql = `SELECT * FROM memory_doc_events WHERE doc_id = $doc_id ORDER BY created_at DESC, id DESC
        LIMIT $limit`;
      return context.db.all(sql, { doc_id: docId, limit })
        .map((row) => readRow(MemoryDocEventSchema, EVENT_COLUMNS, row, 'memory_doc_events'));
    },
  };
}

export function createMemoryDocStores(context: StoreContext) {
  return {
    docs: createDocStore(context),
    lines: createLineStore(context),
    events: createEventStore(context),
  };
}

export type MemoryDocStores = ReturnType<typeof createMemoryDocStores>;
