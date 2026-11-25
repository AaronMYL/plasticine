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
  type MemoryScopeKind,
} from '../../shared/state.ts';
import { checked, encodeRow, OBJECT_META_COLUMNS, readRow, type ColumnMap } from './codec.ts';
import { fromSqliteError, StateError } from './errors.ts';
import { createMemoryDocUsageStore } from './memory-doc-usage.ts';
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
  scopeKind: 'text',
  scopeRef: 'text',
};

const LINE_SPEC: StoreSpec<typeof MemoryLineSchema, typeof MemoryLineInputSchema, typeof MemoryLinePatchSchema> = {
  table: 'memory_doc_lines',
  searchSource: 'memory_line',
  schema: MemoryLineSchema,
  input: MemoryLineInputSchema,
  patch: MemoryLinePatchSchema,
  columns: LINE_COLUMNS,
  defaults: { section: 'note', previous: null, supersedes: [], inferenceId: null, writtenRef: null, retiredAt: null,
    retiredReason: null, archivedAt: null, deletedAt: null, scopeKind: 'all', scopeRef: null },
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
const ARCHIVED = 'archived_at IS NOT NULL AND deleted_at IS NULL';
const ORDER = 'position, created_at, id';

function createDocStore(context: StoreContext) {
  const store = new ObjectStore(context, DOC_SPEC);
  return {
    create: (input: MemoryDocInput, options: CreateOptions = {}): MemoryDoc => store.create(input, undefined, options),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    live: (): MemoryDoc[] => allPages((page) => store.select('retired_at IS NULL', {}, page)),
    forProject: (projectId: string): MemoryDoc | undefined =>
      store.select('project_id = $project_id', { project_id: projectId }, { limit: 1 })[0],
  };
}

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
    rescope(id: string, version: number, scopeKind: MemoryScopeKind, scopeRef: string | null): MemoryLine {
      const current = store.require(id);
      if (current.retiredAt !== null) {
        throw new StateError('version_conflict', '这一行已经退休', { currentVersion: current.version });
      }
      return store.update(id, version, { scopeKind, scopeRef: scopeKind === 'all' ? null : scopeRef });
    },
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
    live: (docId: string): MemoryLine[] => allPages((page) => store.select(LIVE, { doc_id: docId }, page, ORDER)),
    retired: (docId: string): MemoryLine[] => allPages((page) =>
      store.select('doc_id = $doc_id AND retired_at IS NOT NULL AND deleted_at IS NULL', { doc_id: docId }, page,
        'retired_at DESC, id')),
    archived: (docId: string): MemoryLine[] => allPages((page) =>
      store.select(`doc_id = $doc_id AND ${ARCHIVED}`, { doc_id: docId }, page, 'archived_at DESC, id')),
    successor(id: string): MemoryLine | undefined {
      return store.select(`EXISTS (SELECT 1 FROM json_each(memory_doc_lines.supersedes) WHERE value = $id)`, { id },
        { limit: 1 }, 'created_at DESC, id')[0];
    },
    allArchived: (): MemoryLine[] => allPages((page) =>
      store.select(ARCHIVED, {}, page, 'archived_at DESC, id')),
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
    allLive: (): MemoryLine[] => allPages((page) => store.select(`retired_at IS NULL AND doc_id IN
      (SELECT id FROM memory_docs WHERE retired_at IS NULL)`, {}, page, 'doc_id, position, created_at, id')),
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
    count(kind: MemoryDocEventKind, since: string): number {
      const row = context.db.get(`SELECT COUNT(*) AS n FROM memory_doc_events
        WHERE kind = $kind AND created_at >= $since`, { kind, since });
      return Number(row?.['n'] ?? 0);
    },
    usedLines(since: string): number {
      const row = context.db.get(`SELECT COALESCE(SUM(json_array_length(detail, '$.lineIds')), 0) AS n
        FROM memory_doc_events WHERE kind = 'lines_used' AND created_at >= $since`, { since });
      return Number(row?.['n'] ?? 0);
    },
    withDetail(kind: MemoryDocEventKind, field: string, value: string): MemoryDocEvent[] {
      const sql = `SELECT * FROM memory_doc_events WHERE kind = $kind AND json_extract(detail, $path) = $value
        ORDER BY created_at, id`;
      return context.db.all(sql, { kind, path: `$.${field}`, value })
        .map((row) => readRow(MemoryDocEventSchema, EVENT_COLUMNS, row, 'memory_doc_events'));
    },
    soulSection(lineId: string): string | undefined {
      const row = context.db.get(`SELECT json_extract(detail, '$.soulSection') AS section
        FROM memory_doc_events WHERE line_id = $line_id AND json_type(detail, '$.soulSection') = 'text'
        ORDER BY rowid DESC LIMIT 1`, { line_id: lineId });
      return typeof row?.['section'] === 'string' ? row['section'] : undefined;
    },
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
    usage: createMemoryDocUsageStore(context),
  };
}

export type MemoryDocStores = ReturnType<typeof createMemoryDocStores>;
