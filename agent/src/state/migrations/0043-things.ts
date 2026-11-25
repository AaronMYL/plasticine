import type { Migration } from './migrate.ts';
import { booleanColumn, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const SOURCES = `CREATE TABLE intake_sources (${RECORD_COLUMNS},
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  ${booleanColumn('enabled', 1)},
  ${jsonColumn('cursor', true)},
  ${jsonColumn('config', false)},
  last_error TEXT
)`;

const TRIGGERS = `CREATE TABLE triggers (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES intake_sources (id),
  kind TEXT NOT NULL,
  external_key TEXT NOT NULL,
  ${jsonColumn('thread_keys', false)},
  actor TEXT NOT NULL,
  actor_source_kind TEXT NOT NULL,
  ${booleanColumn('addressed', 0)},
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT,
  summary TEXT NOT NULL,
  ${jsonColumn('facts', false)},
  UNIQUE (source_id, external_key)
)`;

const DISPOSITIONS = `CREATE TABLE trigger_dispositions (
  id TEXT PRIMARY KEY NOT NULL,
  trigger_id TEXT NOT NULL REFERENCES triggers (id),
  kind TEXT NOT NULL,
  matter_id TEXT,
  assessment_id TEXT,
  rule_code TEXT,
  actor TEXT NOT NULL,
  reason TEXT,
  at TEXT NOT NULL
)`;

const RULES = `CREATE TABLE rules (${RECORD_COLUMNS},
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  ${jsonColumn('source_kinds', false)},
  ${jsonColumn('trigger_kinds', false)},
  mode TEXT NOT NULL,
  ${booleanColumn('trialable', 0)},
  basis_kind TEXT NOT NULL,
  basis_ref TEXT,
  strength TEXT NOT NULL,
  rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version >= 1)
)`;

const RULE_EVENTS = `CREATE TABLE rule_events (
  id TEXT PRIMARY KEY NOT NULL,
  rule_id TEXT NOT NULL REFERENCES rules (id),
  kind TEXT NOT NULL,
  from_mode TEXT,
  to_mode TEXT,
  rule_version INTEGER NOT NULL,
  actor TEXT NOT NULL,
  ${jsonColumn('evidence_ids', false)},
  reason TEXT,
  at TEXT NOT NULL
)`;

const ASSESSMENTS = `CREATE TABLE assessments (${RECORD_COLUMNS},
  thread_key TEXT NOT NULL,
  ${jsonColumn('trigger_ids', false)},
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_id TEXT,
  policy_version TEXT,
  outcome TEXT,
  ${jsonColumn('rule_judgments', false)},
  matter_id TEXT,
  would_do TEXT,
  error TEXT,
  verdict TEXT,
  verdict_at TEXT,
  verdict_note TEXT,
  confirmed_by_device_id TEXT,
  confirmed_by_device_at TEXT
    CHECK ((confirmed_by_device_at IS NULL) = (confirmed_by_device_id IS NULL))
)`;

const MATTERS = `CREATE TABLE matters (${RECORD_COLUMNS},
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  thread_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  anchor_type TEXT,
  anchor_id TEXT,
  origin TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'normal',
  goal TEXT,
  ${jsonColumn('key_points', false)},
  ${jsonColumn('waiting_for', true)},
  lifecycle TEXT NOT NULL,
  end_outcome TEXT,
  ended_at TEXT,
  ended_by TEXT,
  merged_into TEXT,
  last_activity_at TEXT NOT NULL,
  trial_state TEXT,
  surfaced_at TEXT
)`;

const MANDATES = `CREATE TABLE matter_mandates (
  id TEXT PRIMARY KEY NOT NULL,
  matter_id TEXT NOT NULL REFERENCES matters (id),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  strength TEXT NOT NULL,
  basis_kind TEXT NOT NULL,
  basis_ref TEXT,
  rule_id TEXT,
  rule_version INTEGER,
  policy_version TEXT,
  scope TEXT NOT NULL,
  ${jsonColumn('constraints', false)},
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT,
  UNIQUE (matter_id, seq)
)`;

const SUBSCRIPTIONS = `CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  matter_id TEXT NOT NULL REFERENCES matters (id),
  thread_key TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dropped_at TEXT,
  dropped_by TEXT
)`;

const INPUTS = `CREATE TABLE matter_inputs (
  id TEXT PRIMARY KEY NOT NULL,
  matter_id TEXT NOT NULL REFERENCES matters (id),
  kind TEXT NOT NULL,
  trigger_id TEXT,
  ref TEXT,
  ${booleanColumn('from_person', 0)},
  delivered_at TEXT NOT NULL,
  read_at TEXT,
  handled TEXT NOT NULL DEFAULT 'none'
)`;

export const migration: Migration = {
  id: '0043-things',
  up(db) {
    for (const table of [SOURCES, TRIGGERS, DISPOSITIONS, RULES, RULE_EVENTS, ASSESSMENTS, MATTERS, MANDATES,
      SUBSCRIPTIONS, INPUTS]) {
      db.exec(table);
    }
    db.exec('CREATE INDEX triggers_received ON triggers (received_at)');
    db.exec('CREATE INDEX trigger_dispositions_trigger ON trigger_dispositions (trigger_id, at)');
    db.exec('CREATE INDEX trigger_dispositions_kind ON trigger_dispositions (kind, at)');
    db.exec('CREATE INDEX assessments_thread ON assessments (thread_key, status)');
    db.exec('CREATE INDEX matters_activity ON matters (lifecycle, last_activity_at)');
    db.exec('CREATE INDEX matters_project ON matters (project_id)');
    db.exec(`CREATE UNIQUE INDEX subscriptions_live ON subscriptions (matter_id, thread_key)
      WHERE dropped_at IS NULL`);
    db.exec('CREATE INDEX subscriptions_key ON subscriptions (thread_key) WHERE dropped_at IS NULL');
    db.exec('CREATE INDEX matter_inputs_matter ON matter_inputs (matter_id, delivered_at)');
    db.exec('ALTER TABLE tasks ADD COLUMN matter_id TEXT REFERENCES matters (id)');
    db.exec("ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal'");
    db.exec('CREATE INDEX tasks_matter ON tasks (matter_id)');
    db.exec('ALTER TABLE asks ADD COLUMN matter_id TEXT REFERENCES matters (id)');
  },
};
