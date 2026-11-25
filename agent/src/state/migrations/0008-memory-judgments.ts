import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const DEVICE_KEYS = `CREATE TABLE device_keys (${RECORD_COLUMNS},
  device_id TEXT NOT NULL REFERENCES devices (id),
  ${jsonColumn('public_key', false)},
  thumbprint TEXT NOT NULL,
  revoked_at TEXT
)`;

const DISAGREEMENT_MARKS = `CREATE TABLE disagreement_marks (${RECORD_COLUMNS},
  target_type TEXT NOT NULL CHECK (target_type IN ${inList(['judgment', 'agreement', 'memory_entry'])}),
  target_id TEXT NOT NULL,
  target_version INTEGER NOT NULL CHECK (target_version >= 1),
  user_position TEXT NOT NULL,
  brain_position TEXT NOT NULL,
  user_basis TEXT NOT NULL,
  brain_basis TEXT NOT NULL,
  what_would_change_user TEXT NOT NULL,
  what_would_change_brain TEXT NOT NULL,
  ${jsonColumn('user_sources', false)},
  ${jsonColumn('brain_sources', false)},
  run_id TEXT,
  action_id TEXT,
  status TEXT NOT NULL CHECK (status IN ${inList(['open', 'resolved'])}),
  resolved_at TEXT,
  resolution TEXT
)`;

const DISAGREEMENT_ACTIONS = `CREATE TABLE disagreement_actions (
  action_id TEXT PRIMARY KEY NOT NULL,
  mark_id TEXT NOT NULL REFERENCES disagreement_marks (id),
  created_at TEXT NOT NULL
)`;

const LEGACY_ROWS = `CREATE TABLE legacy_rows (
  source_db TEXT NOT NULL,
  source_table TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  target_table TEXT,
  target_id TEXT,
  ${jsonColumn('payload', false)},
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_db, source_table, legacy_id),
  CHECK ((target_table IS NULL) = (target_id IS NULL))
)`;

const STATEMENTS = [
  DEVICE_KEYS,
  'CREATE UNIQUE INDEX device_keys_live ON device_keys (device_id) WHERE revoked_at IS NULL',
  'CREATE UNIQUE INDEX device_keys_thumbprint_live ON device_keys (thumbprint) WHERE revoked_at IS NULL',
  'ALTER TABLE api_requests ADD COLUMN body_digest TEXT',
  `ALTER TABLE judgments ADD COLUMN ${booleanColumn('discussing', 0)}`,
  DISAGREEMENT_MARKS,
  `CREATE UNIQUE INDEX disagreement_marks_open ON disagreement_marks (target_type, target_id)
    WHERE status = 'open'`,
  'CREATE INDEX disagreement_marks_target ON disagreement_marks (target_type, target_id)',
  DISAGREEMENT_ACTIONS,
  LEGACY_ROWS,
  'CREATE INDEX legacy_rows_target ON legacy_rows (target_table, target_id)',
];

export const migration: Migration = {
  id: '0008-memory-judgments',
  up(db) {
    for (const statement of STATEMENTS) {
      db.exec(statement);
    }
  },
};
