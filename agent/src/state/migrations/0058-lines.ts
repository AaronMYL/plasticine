import type { Migration } from './migrate.ts';
import { jsonColumn } from './sql.ts';

const LINES = `CREATE TABLE lines (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  parent_line_id TEXT REFERENCES lines (id),
  project_id TEXT REFERENCES projects (id),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  paused_until TEXT,
  failure TEXT,
  pause_noticed_at TEXT,
  summary TEXT,
  summary_seq INTEGER NOT NULL DEFAULT 0 CHECK (summary_seq >= 0)
)`;

const LINE_MESSAGES = `CREATE TABLE line_messages (
  line_id TEXT NOT NULL REFERENCES lines (id),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  role TEXT NOT NULL,
  ${jsonColumn('message', false)},
  created_at TEXT NOT NULL,
  PRIMARY KEY (line_id, seq)
)`;

const LINE_QUEUE = `CREATE TABLE line_queue (
  id TEXT PRIMARY KEY NOT NULL,
  line_id TEXT NOT NULL REFERENCES lines (id),
  text TEXT NOT NULL,
  ${jsonColumn('attachments', false)},
  status TEXT NOT NULL,
  sent_seq INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const LINE_APPROVALS = `CREATE TABLE line_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  line_id TEXT NOT NULL REFERENCES lines (id),
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_digest TEXT NOT NULL,
  hard_line TEXT NOT NULL,
  ask_id TEXT NOT NULL REFERENCES asks (id),
  status TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (line_id, tool_call_id)
)`;

const KERNEL_SETTINGS = `CREATE TABLE kernel_settings (
  key TEXT PRIMARY KEY NOT NULL,
  ${jsonColumn('value', false)},
  updated_at TEXT NOT NULL
)`;

const KERNEL_CREDENTIALS = `CREATE TABLE kernel_credentials (
  provider_id TEXT PRIMARY KEY NOT NULL,
  type TEXT,
  ${jsonColumn('credential', true)},
  updated_at TEXT NOT NULL
)`;

const INDEXES = [
  "CREATE UNIQUE INDEX lines_one_main ON lines (kind) WHERE kind = 'main'",
  'CREATE INDEX lines_status ON lines (status, updated_at)',
  'CREATE INDEX lines_parent ON lines (parent_line_id)',
  'CREATE INDEX line_queue_line ON line_queue (line_id, status, created_at)',
  'CREATE INDEX line_approvals_ask ON line_approvals (ask_id)',
];

export const migration: Migration = {
  id: '0058-lines',
  up(db) {
    for (const sql of [LINES, LINE_MESSAGES, LINE_QUEUE, LINE_APPROVALS, KERNEL_SETTINGS, KERNEL_CREDENTIALS,
      ...INDEXES]) {
      db.exec(sql);
    }
  },
};
