// 记忆整理的存取（docs/specs/memory-docs.md）：拿不准的推断（status / decidedAt 只经设备确认写入）、
// 后台整理的作业队列、一次性迁移的进度和每条旧条目的去向。只做存取；整理的规矩在 brain/。

import {
  FORGOTTEN_TEXT,
  MemoryEntryMigrationSchema,
  MemoryInferenceConfirmedSchema,
  MemoryInferenceInputSchema,
  MemoryInferencePatchSchema,
  MemoryInferenceSchema,
  MemoryJobInputSchema,
  MemoryJobPatchSchema,
  MemoryJobSchema,
  MemoryMigrationStateSchema,
  type CreateOptions,
  type DeviceConfirmation,
  type MemoryEntryMigration,
  type MemoryInference,
  type MemoryInferenceConfirmed,
  type MemoryInferenceInput,
  type MemoryInferencePatch,
  type MemoryJob,
  type MemoryJobInput,
  type MemoryJobKind,
  type MemoryJobStatus,
  type MemoryMigrationState,
  type Page,
} from '../../shared/state.ts';
import { checked, CONFIRMATION_META_COLUMNS, encodeRow, RECORD_META_COLUMNS, readRow,
  type ColumnMap } from './codec.ts';
import { StateError } from './errors.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const INFERENCE_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  ...CONFIRMATION_META_COLUMNS,
  docId: 'text',
  section: 'text',
  text: 'text',
  why: 'text',
  anchors: 'json',
  jobId: 'text',
  status: 'text',
  decidedAt: 'text',
  lineId: 'text',
};

const INFERENCE_SPEC: StoreSpec<typeof MemoryInferenceSchema, typeof MemoryInferenceInputSchema,
  typeof MemoryInferencePatchSchema, typeof MemoryInferenceConfirmedSchema> = {
  table: 'memory_inferences',
  schema: MemoryInferenceSchema,
  input: MemoryInferenceInputSchema,
  patch: MemoryInferencePatchSchema,
  confirmedInput: MemoryInferenceConfirmedSchema,
  columns: INFERENCE_COLUMNS,
  defaults: { section: 'note', jobId: null, status: 'pending', decidedAt: null, lineId: null },
  // 推断算不算数只有用户定（同约定生效、p）：普通写入只能写 pending，或由系统撤回（withdrawn，第 99 条④）。
  confirmed: [{ field: 'status', freeValues: ['pending', 'withdrawn'] }, { field: 'decidedAt' }],
};

const JOB_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  key: 'text',
  kind: 'text',
  runId: 'text',
  chatId: 'text',
  replyId: 'text',
  docId: 'text',
  sourceIds: 'json',
  status: 'text',
  attempts: 'integer',
  error: 'text',
  result: 'json',
  startedAt: 'text',
  finishedAt: 'text',
};

const JOB_SPEC: StoreSpec<typeof MemoryJobSchema, typeof MemoryJobInputSchema, typeof MemoryJobPatchSchema> = {
  table: 'memory_curation_jobs',
  schema: MemoryJobSchema,
  input: MemoryJobInputSchema,
  patch: MemoryJobPatchSchema,
  columns: JOB_COLUMNS,
  defaults: { runId: null, chatId: null, replyId: null, docId: null, status: 'queued', attempts: 0, error: null,
    result: null, startedAt: null, finishedAt: null },
};

const LEDGER_COLUMNS: ColumnMap = {
  entryId: 'text',
  jobId: 'text',
  outcome: 'text',
  targetId: 'text',
  note: 'text',
  createdAt: 'text',
};

// 每条旧条目只记一次去向：重跑同一批时已记过的不动（ON CONFLICT DO NOTHING 不删也不替换）。
const LEDGER_SQL = `INSERT INTO memory_entry_migrations (entry_id, job_id, outcome, target_id, note, created_at)
  VALUES ($entry_id, $job_id, $outcome, $target_id, $note, $created_at) ON CONFLICT (entry_id) DO NOTHING`;
const MIGRATION_ID = 'memory-docs';
// 截止点之前建的、还没有去向的旧条目（删过的、过时的也算，由脑记成 skipped）。
const PENDING_ENTRIES = `FROM memory_entries e WHERE e.created_at <= $cutoff
  AND NOT EXISTS (SELECT 1 FROM memory_entry_migrations m WHERE m.entry_id = e.id)`;

// 排队的先后：对话轮之后的整理最要紧，其次合并压缩，迁移批次在空闲时做。
const JOB_PRIORITY: Readonly<Record<MemoryJobKind, number>> = { turn: 0, contact: 1, compact: 1, migration: 2 };

/** 挪文档、撤回只对还没定的推断：用户已经确认或否掉的，系统不能再改它的去处和状态。 */
function requirePending(current: MemoryInference, action: string): void {
  if (current.status !== 'pending') {
    throw new StateError('version_conflict', `这条推断已经是 ${current.status}，不能${action}`,
      { currentVersion: current.version });
  }
}

function createInferenceStore(context: StoreContext) {
  const store = new ObjectStore(context, INFERENCE_SPEC);
  const update = (id: string, version: number, patch: MemoryInferencePatch): MemoryInference => {
    if (patch.status !== undefined || patch.docId !== undefined) {
      requirePending(store.require(id), '再挪文档或撤回');
    }
    return store.update(id, version, patch);
  };
  return {
    create: (input: MemoryInferenceInput, options: CreateOptions = {}): MemoryInference =>
      store.create(input, undefined, options),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update,
    /** 系统撤回一条还没定的推断（重复、错了或被新的一条替代）；不是用户否掉，decidedAt 和设备确认仍为空。 */
    withdraw: (id: string, version: number): MemoryInference => update(id, version, { status: 'withdrawn' }),
    /** 把还没定的推断挪到另一份在用的文档。 */
    move(id: string, version: number, docId: string): MemoryInference {
      const row = context.db.get('SELECT retired_at FROM memory_docs WHERE id = $id', { id: docId });
      if (row === undefined || row['retired_at'] !== null) {
        throw new StateError('not_found', `memory_docs 里没有在用的 ${docId}`);
      }
      return update(id, version, { docId });
    },
    /** 用户在设备上确认或否掉；没有设备确认就拒绝（confirmed-fields.ts）。 */
    decide(id: string, version: number, fields: MemoryInferenceConfirmed, confirmation: DeviceConfirmation,
      reason: string): MemoryInference {
      return store.confirm(id, version, fields, confirmation, reason);
    },
    /**
     * 他说「忘掉」的行删掉以后（11-07 他定真删）：写成那一行的推断，原文换成 FORGOTTEN_TEXT、理由清空；状态和他的
     * 确认（用户确认字段）不动。调用方在 erasing 事务里调。
     */
    forgetLines(lineIds: readonly string[]): void {
      const at = context.now();
      for (const id of lineIds) {
        context.db.run(`UPDATE memory_inferences SET text = $text, why = '', version = version + 1, updated_at = $at
          WHERE line_id = $id AND (text != $text OR why != '')`, { id, text: FORGOTTEN_TEXT, at });
      }
    },
    /** 某个状态的推断，新的在前。 */
    list: (status: MemoryInference['status'], page: Page = {}): MemoryInference[] =>
      store.select('status = $status', { status }, page, 'created_at DESC, id DESC'),
    pendingForDoc: (docId: string): MemoryInference[] => allPages((page) =>
      store.select("status = 'pending' AND doc_id = $doc_id", { doc_id: docId }, page)),
    count(status: MemoryInference['status']): number {
      const row = context.db.get('SELECT COUNT(*) AS n FROM memory_inferences WHERE status = $status', { status });
      return Number(row?.['n'] ?? 0);
    },
  };
}

function createJobStore(context: StoreContext) {
  const store = new ObjectStore(context, JOB_SPEC);
  const byKey = (key: string): MemoryJob | undefined => store.select('key = $key', { key }, { limit: 1 })[0];
  return {
    /** 同一个 key 只排一次：重放、重复入队都回到原来那一条。 */
    enqueue(input: MemoryJobInput): { job: MemoryJob; created: boolean } {
      return context.db.transaction(() => {
        const existing = byKey(input.key);
        if (existing !== undefined) {
          return { job: existing, created: false };
        }
        return { job: store.create(input), created: true };
      });
    },
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    byKey,
    /** 下一条该做的排队作业：先按种类，再按先后。 */
    nextQueued(): MemoryJob | undefined {
      const queued = allPages((page) => store.select("status = 'queued'", {}, page, 'created_at, id'));
      return queued.sort((a, b) => JOB_PRIORITY[a.kind] - JOB_PRIORITY[b.kind])[0];
    },
    withStatus: (status: MemoryJobStatus): MemoryJob[] => allPages((page) =>
      store.select('status = $status', { status }, page, 'updated_at DESC, id DESC')),
    /** 某份文档还在排或在做的合并压缩。 */
    openCompaction: (docId: string): MemoryJob | undefined => store.select(
      "kind = 'compact' AND doc_id = $doc_id AND status IN ('queued', 'running')", { doc_id: docId }, { limit: 1 })[0],
    countCompactions(docId: string): number {
      const row = context.db.get(`SELECT COUNT(*) AS n FROM memory_curation_jobs
        WHERE kind = 'compact' AND doc_id = $doc_id`, { doc_id: docId });
      return Number(row?.['n'] ?? 0);
    },
    count(status: MemoryJobStatus): number {
      const row = context.db.get('SELECT COUNT(*) AS n FROM memory_curation_jobs WHERE status = $status', { status });
      return Number(row?.['n'] ?? 0);
    },
  };
}

function createMigrationStore(context: StoreContext) {
  const readState = (): MemoryMigrationState | undefined => {
    const row = context.db.get('SELECT started_at, cutoff, finished_at FROM memory_doc_migration WHERE id = $id',
      { id: MIGRATION_ID });
    if (row === undefined) {
      return undefined;
    }
    const value = { startedAt: row['started_at'], cutoff: row['cutoff'], finishedAt: row['finished_at'] };
    return checked(MemoryMigrationStateSchema, value, 'corrupt_record', 'memory_doc_migration');
  };
  return {
    state: readState,
    /** 迁移做完了没有：做完之后上下文不再装旧条目。 */
    finished: (): boolean => readState()?.finishedAt != null,
    /** 第一次调用记下截止点；之后再调回原来的那一行。 */
    start(cutoff: string): MemoryMigrationState {
      const sql = `INSERT INTO memory_doc_migration (id, started_at, cutoff, finished_at)
        VALUES ($id, $started_at, $cutoff, NULL) ON CONFLICT (id) DO NOTHING`;
      context.db.run(sql, { id: MIGRATION_ID, started_at: context.now(), cutoff });
      const state = readState();
      if (state === undefined) {
        throw new StateError('corrupt_record', '写 memory_doc_migration 后读不到迁移进度');
      }
      return state;
    },
    finish(): void {
      context.db.run('UPDATE memory_doc_migration SET finished_at = $at WHERE id = $id AND finished_at IS NULL',
        { id: MIGRATION_ID, at: context.now() });
    },
    pendingEntryIds(cutoff: string, limit: number): string[] {
      const sql = `SELECT e.id ${PENDING_ENTRIES} ORDER BY e.created_at, e.id LIMIT $limit`;
      return context.db.all(sql, { cutoff, limit }).map((row) => String(row['id']));
    },
    progress(cutoff: string): { total: number; pending: number } {
      const total = context.db.get('SELECT COUNT(*) AS n FROM memory_entries WHERE created_at <= $cutoff', { cutoff });
      const pending = context.db.get(`SELECT COUNT(*) AS n ${PENDING_ENTRIES}`, { cutoff });
      return { total: Number(total?.['n'] ?? 0), pending: Number(pending?.['n'] ?? 0) };
    },
    record(input: Omit<MemoryEntryMigration, 'createdAt'>): void {
      const row = checked(MemoryEntryMigrationSchema, { ...input, createdAt: context.now() }, 'invalid_input',
        '写 memory_entry_migrations');
      context.db.run(LEDGER_SQL, encodeRow(LEDGER_COLUMNS, row));
    },
    find(entryId: string): MemoryEntryMigration | undefined {
      const row = context.db.get('SELECT * FROM memory_entry_migrations WHERE entry_id = $id', { id: entryId });
      return row === undefined ? undefined
        : readRow(MemoryEntryMigrationSchema, LEDGER_COLUMNS, row, 'memory_entry_migrations');
    },
  };
}

export function createMemoryCurationStores(context: StoreContext) {
  return {
    inferences: createInferenceStore(context),
    jobs: createJobStore(context),
    migration: createMigrationStore(context),
  };
}

export type MemoryCurationStores = ReturnType<typeof createMemoryCurationStores>;
