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

const LEDGER_SQL = `INSERT INTO memory_entry_migrations (entry_id, job_id, outcome, target_id, note, created_at)
  VALUES ($entry_id, $job_id, $outcome, $target_id, $note, $created_at) ON CONFLICT (entry_id) DO NOTHING`;
const MIGRATION_ID = 'memory-docs';
const PENDING_ENTRIES = `FROM memory_entries e WHERE e.created_at <= $cutoff
  AND NOT EXISTS (SELECT 1 FROM memory_entry_migrations m WHERE m.entry_id = e.id)`;

const JOB_PRIORITY: Readonly<Record<MemoryJobKind, number>> = { turn: 0, contact: 1, compact: 1, migration: 2 };

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
    withdraw: (id: string, version: number): MemoryInference => update(id, version, { status: 'withdrawn' }),
    move(id: string, version: number, docId: string): MemoryInference {
      const row = context.db.get('SELECT retired_at FROM memory_docs WHERE id = $id', { id: docId });
      if (row === undefined || row['retired_at'] !== null) {
        throw new StateError('not_found', `memory_docs 里没有在用的 ${docId}`);
      }
      return update(id, version, { docId });
    },
    decide(id: string, version: number, fields: MemoryInferenceConfirmed, confirmation: DeviceConfirmation,
      reason: string): MemoryInference {
      return store.confirm(id, version, fields, confirmation, reason);
    },
    forgetLines(lineIds: readonly string[]): void {
      const at = context.now();
      for (const id of lineIds) {
        context.db.run(`UPDATE memory_inferences SET text = $text, why = '', version = version + 1, updated_at = $at
          WHERE line_id = $id AND (text != $text OR why != '')`, { id, text: FORGOTTEN_TEXT, at });
      }
    },
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
    nextQueued(): MemoryJob | undefined {
      const queued = allPages((page) => store.select("status = 'queued'", {}, page, 'created_at, id'));
      return queued.sort((a, b) => JOB_PRIORITY[a.kind] - JOB_PRIORITY[b.kind])[0];
    },
    withStatus: (status: MemoryJobStatus): MemoryJob[] => allPages((page) =>
      store.select('status = $status', { status }, page, 'updated_at DESC, id DESC')),
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
    finished: (): boolean => readState()?.finishedAt != null,
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
