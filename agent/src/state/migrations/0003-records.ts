// First batch (M0), part 3: version history, the old-id map, conversation records and telemetry.
// Enumerations are written out on purpose; see 0001-objects.ts.

import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, MIGRATION_COLUMNS, OBJECT_COLUMNS } from './sql.ts';

const OBJECT_TYPES = ['concern', 'judgment', 'evidence', 'agreement', 'task', 'memory_entry', 'source'];
const ACTORS = ['user', 'brain', 'hand', 'system', 'migration'];
const REASON_KINDS = ['new_evidence', 'reasoning_fix', 'premise_clarified', 'context_changed', 'user_correction'];

// Append-only. guide_revisions 迁进来时也落在这里（《实施方案》第 4 节约定一行）。
const VERSIONS = `CREATE TABLE versions (
  id TEXT PRIMARY KEY NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ${inList(OBJECT_TYPES)}),
  object_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  actor TEXT NOT NULL CHECK (actor IN ${inList(ACTORS)}),
  actor_ref TEXT,
  reason TEXT NOT NULL,
  reason_kind TEXT CHECK (reason_kind IS NULL OR reason_kind IN ${inList(REASON_KINDS)}),
  ${jsonColumn('fields', false)},
  ${jsonColumn('snapshot', false)},
  confirmed_by_device_id TEXT,
  confirmed_by_device_at TEXT,
  created_at TEXT NOT NULL,${MIGRATION_COLUMNS},
  UNIQUE (object_type, object_id, version)
)`;

// 迁移规则 1：可重跑、幂等，按旧 id 映射表去重。主键保证同一条旧记录只映射一次。
const LEGACY_IDS = `CREATE TABLE legacy_ids (
  source_db TEXT NOT NULL,
  source_table TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_db, source_table, legacy_id)
)`;

const RUNS = `CREATE TABLE runs (${OBJECT_COLUMNS},
  kind TEXT NOT NULL CHECK (kind IN ${inList(['conversation', 'task'])}),
  chat_id TEXT,
  task_id TEXT REFERENCES tasks (id),
  request_id TEXT,
  model TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ${inList(['running', 'completed', 'failed', 'interrupted', 'yielded'])}),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT
)`;

// 结论可空：旧回复整段进「理由」、结论标待补（10-27 第 80 条），待补标记在 reply_layers 里。
const MESSAGES = `CREATE TABLE messages (${OBJECT_COLUMNS},
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ${inList(['user', 'assistant', 'system', 'tool'])}),
  content TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  request_id TEXT UNIQUE,
  run_id TEXT REFERENCES runs (id),
  ${jsonColumn('reply_layers', true)},
  ${jsonColumn('disagreement', true)},
  ${jsonColumn('attachments', false)},
  ${booleanColumn('active', 1)}
)`;

const RUN_EVENTS = `CREATE TABLE run_events (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs (id),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  kind TEXT NOT NULL,
  ${jsonColumn('payload', false)},
  created_at TEXT NOT NULL,${MIGRATION_COLUMNS},
  UNIQUE (run_id, seq)
)`;

// 10-26 第 63 条：遥测并进新库。
const TELEMETRY_EVENTS = `CREATE TABLE telemetry_events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  device_id TEXT,
  ${jsonColumn('payload', false)},
  created_at TEXT NOT NULL,${MIGRATION_COLUMNS}
)`;

const INDEXES = [
  'CREATE INDEX legacy_ids_target ON legacy_ids (target_table, target_id)',
  'CREATE INDEX runs_chat ON runs (chat_id, started_at)',
  'CREATE INDEX runs_outcome ON runs (outcome)',
  'CREATE INDEX messages_chat ON messages (chat_id, sent_at)',
  'CREATE INDEX telemetry_events_name ON telemetry_events (name, occurred_at)',
];

export const migration: Migration = {
  id: '0003-records',
  up(db) {
    for (const statement of [VERSIONS, LEGACY_IDS, RUNS, MESSAGES, RUN_EVENTS, TELEMETRY_EVENTS, ...INDEXES]) {
      db.exec(statement);
    }
  },
};
