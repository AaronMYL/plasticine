// First batch (M0), part 2: tasks and the harness tables around them (《实施方案》第 7 节; harness 设计稿 5.0、5.3).
// Enumerations are written out on purpose; see 0001-objects.ts.

import type { Migration } from './migrate.ts';
import { inList, jsonColumn, MIGRATION_COLUMNS, OBJECT_COLUMNS, RECORD_COLUMNS } from './sql.ts';

// 十种状态（《从零方案》第 5 节）。旧库的 17 种状态名不进这一列，存进 legacy_status（迁移规则 4）。
const TASK_STATUSES = inList([
  'queued',
  'running',
  'waiting_input',
  'waiting_approval',
  'awaiting_acceptance',
  'delivered',
  'partially_delivered',
  'paused',
  'cancelled',
  'archived',
]);

const TASKS = `CREATE TABLE tasks (${OBJECT_COLUMNS},
  title TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ${TASK_STATUSES}),
  legacy_status TEXT,
  concern_id TEXT REFERENCES concerns (id),
  activity_id TEXT,
  goal_version INTEGER NOT NULL CHECK (goal_version >= 1),
  latest_user_quote TEXT,
  cited_proposal TEXT,
  ${jsonColumn('acceptance', false)},
  scope TEXT,
  ${jsonColumn('prohibitions', false)},
  ${jsonColumn('agreement_ids', false)},
  executor TEXT,
  plan_version INTEGER NOT NULL CHECK (plan_version >= 0),
  current_run_id TEXT,
  progress TEXT,
  retry_budget INTEGER NOT NULL CHECK (retry_budget >= 0),
  attempts_used INTEGER NOT NULL CHECK (attempts_used >= 0),
  ${jsonColumn('failure_signatures', false)},
  last_failure_signature TEXT,
  signature_repeats INTEGER NOT NULL CHECK (signature_repeats >= 0),
  retry_at TEXT,
  wait_kind TEXT,
  waiting_on TEXT,
  pending_decision TEXT,
  verifier_policy TEXT NOT NULL,
  verify_method TEXT,
  ${jsonColumn('results', false)},
  ${jsonColumn('four_questions', true)},
  action_id TEXT UNIQUE,
  received_at TEXT,
  delivered_at TEXT,
  verified_at TEXT
)`;

const TASK_STEPS = `CREATE TABLE task_steps (${RECORD_COLUMNS},
  task_id TEXT NOT NULL REFERENCES tasks (id),
  step_key TEXT NOT NULL,
  plan_version INTEGER NOT NULL CHECK (plan_version >= 0),
  title TEXT NOT NULL,
  active_form TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ${inList(['pending', 'in_progress', 'done', 'cancelled'])}),
  ${jsonColumn('depends_on', false)},
  ${jsonColumn('acceptance_ids', false)},
  ${jsonColumn('evidence_ids', false)},
  updated_by TEXT NOT NULL,
  UNIQUE (task_id, plan_version, step_key)
)`;

const CLAIMS = `CREATE TABLE claims (${RECORD_COLUMNS},
  task_id TEXT NOT NULL REFERENCES tasks (id),
  run_id TEXT,
  executor TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  heartbeat_at TEXT,
  released_at TEXT
)`;

const TASK_RUNS = `CREATE TABLE task_runs (${RECORD_COLUMNS},
  task_id TEXT NOT NULL REFERENCES tasks (id),
  run_id TEXT,
  step_key TEXT,
  role TEXT NOT NULL CHECK (role IN ${inList(['worker', 'verifier', 'diagnosis'])}),
  model TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT CHECK (
    outcome IS NULL OR outcome IN ${inList(['completed', 'failed', 'interrupted', 'yielded', 'rejected'])}
  ),
  summary TEXT,
  error_class TEXT,
  failure_signature TEXT,
  claim_id TEXT REFERENCES claims (id)
)`;

// Append-only: rows are never updated, so no version column. seq orders events across all tasks.
const TASK_EVENTS = `CREATE TABLE task_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  run_id TEXT,
  kind TEXT NOT NULL,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ${TASK_STATUSES}),
  to_status TEXT CHECK (to_status IS NULL OR to_status IN ${TASK_STATUSES}),
  actor TEXT NOT NULL CHECK (actor IN ${inList(['user', 'brain', 'hand', 'system', 'migration'])}),
  actor_ref TEXT,
  reason TEXT NOT NULL,
  ${jsonColumn('evidence_ids', false)},
  created_at TEXT NOT NULL,${MIGRATION_COLUMNS}
)`;

const TASK_LINKS = `CREATE TABLE task_links (
  parent_id TEXT NOT NULL REFERENCES tasks (id),
  child_id TEXT NOT NULL REFERENCES tasks (id),
  kind TEXT NOT NULL CHECK (kind IN ${inList(['depends_on', 'subtask'])}),
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_id, kind),
  CHECK (parent_id <> child_id)
)`;

// 回执以 action_id 为主键：同一动作只有一行，重放查到它就不再执行（《实施方案》第 7 节「回执幂等」）。
const RECEIPTS = `CREATE TABLE receipts (
  action_id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  task_id TEXT REFERENCES tasks (id),
  step_key TEXT,
  attempt INTEGER CHECK (attempt IS NULL OR attempt >= 0),
  run_id TEXT,
  tool TEXT NOT NULL,
  args_digest TEXT NOT NULL,
  replay TEXT NOT NULL CHECK (replay IN ${inList(['safe', 'once'])}),
  effect TEXT NOT NULL CHECK (effect IN ${inList(['read', 'internal', 'external'])}),
  status TEXT NOT NULL CHECK (status IN ${inList(['issued', 'succeeded', 'failed', 'unknown', 'dry_run'])}),
  result_ref TEXT,
  received_at TEXT,
  delivered_at TEXT,
  executed_at TEXT,
  verified_at TEXT
)`;

const INDEXES = [
  'CREATE INDEX tasks_status ON tasks (status)',
  'CREATE INDEX tasks_concern ON tasks (concern_id)',
  'CREATE INDEX task_steps_task ON task_steps (task_id, plan_version)',
  'CREATE INDEX task_runs_task ON task_runs (task_id)',
  'CREATE INDEX task_events_task ON task_events (task_id, seq)',
  'CREATE INDEX task_links_child ON task_links (child_id)',
  'CREATE INDEX receipts_task ON receipts (task_id)',
  'CREATE INDEX receipts_status ON receipts (status)',
  'CREATE INDEX claims_task ON claims (task_id)',
];

export const migration: Migration = {
  id: '0002-tasks',
  up(db) {
    for (const statement of [TASKS, TASK_STEPS, CLAIMS, TASK_RUNS, TASK_EVENTS, TASK_LINKS, RECEIPTS, ...INDEXES]) {
      db.exec(statement);
    }
  },
};
