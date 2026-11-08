// M5 乙路：日常事务、站内信、工具组、成果和笔记版本（《实施方案》第 4 节 money_* · focus_* · reminders · inbox ·
// artifacts，第 2 节「JSON 文件：记账、专注、站内信等进表」）。只加表（10-26 第 25 条）。
// - money_categories / money_accounts / money_entries：金额都是整数分；一笔删了只打 deleted_at。
// - focus_sessions：同一时间只有一段在跑（部分唯一索引）；心跳记最后一次和哪台设备。
// - reminders：到点只记 fired_at，删只打 deleted_at。
// - inbox_messages（同一封邮件的 Message-ID 只一行）、inbox_replies（action_id 唯一：重放不发第二封）、inbox_sync（一行）。
// - tool_groups：一组一行，开关是用户确认字段（带设备确认的两列）。
// - artifacts / artifact_versions：成果和它的每个版本（版本只追加）。
// - note_versions：笔记每次保存一个正文文件（review-followups e4cef52）。
// - telemetry_settings：交互遥测的开关，一行。
// 可能会长的集合（来源、成果种类、记账来源）只在 shared 的 schema 里校验（state-schema.md 第 2 项）。

import type { Migration } from './migrate.ts';
import {
  booleanColumn,
  CONFIRMATION_COLUMNS,
  inList,
  jsonColumn,
  OBJECT_COLUMNS,
  RECORD_COLUMNS,
} from './sql.ts';

const MONEY_CATEGORIES = `CREATE TABLE money_categories (${OBJECT_COLUMNS},
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ${inList(['expense', 'income'])}),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0)
)`;

const MONEY_ACCOUNTS = `CREATE TABLE money_accounts (${OBJECT_COLUMNS},
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  opening_cents INTEGER NOT NULL,
  ${booleanColumn('excluded', 0)},
  note TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  archived_at TEXT
)`;

const MONEY_ENTRIES = `CREATE TABLE money_entries (${OBJECT_COLUMNS},
  kind TEXT NOT NULL CHECK (kind IN ${inList(['expense', 'income', 'transfer', 'refund'])}),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL,
  cny_cents INTEGER NOT NULL CHECK (cny_cents >= 0),
  category_id TEXT REFERENCES money_categories (id),
  account_id TEXT REFERENCES money_accounts (id),
  to_account_id TEXT REFERENCES money_accounts (id),
  merchant TEXT,
  note TEXT,
  occurred_at TEXT NOT NULL,
  discount_cents INTEGER CHECK (discount_cents IS NULL OR discount_cents > 0),
  fee_cents INTEGER CHECK (fee_cents IS NULL OR fee_cents > 0),
  origin TEXT NOT NULL,
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  ${booleanColumn('review', 0)},
  deleted_at TEXT
)`;

const FOCUS_SESSIONS = `CREATE TABLE focus_sessions (${OBJECT_COLUMNS},
  label TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes >= 1),
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  judgment_id TEXT,
  device_id TEXT,
  status TEXT NOT NULL CHECK (status IN ${inList(['running', 'done', 'stopped'])}),
  ended_at TEXT,
  actual_minutes INTEGER CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  last_heartbeat_at TEXT,
  heartbeat_device_id TEXT
)`;

const REMINDERS = `CREATE TABLE reminders (${OBJECT_COLUMNS},
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  due_at TEXT NOT NULL,
  origin TEXT NOT NULL,
  fired_at TEXT,
  deleted_at TEXT
)`;

const INBOX_MESSAGES = `CREATE TABLE inbox_messages (${OBJECT_COLUMNS},
  source TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_name TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TEXT NOT NULL,
  ${booleanColumn('act', 0)},
  ${jsonColumn('attachments', false)},
  message_id TEXT UNIQUE,
  to_address TEXT,
  ref TEXT,
  read_at TEXT,
  starred_at TEXT,
  archived_at TEXT,
  handled_at TEXT,
  handled_note TEXT
)`;

const INBOX_REPLIES = `CREATE TABLE inbox_replies (${RECORD_COLUMNS},
  message_id TEXT NOT NULL REFERENCES inbox_messages (id),
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ${inList(['stored', 'sending', 'sent', 'dry_run', 'failed', 'unknown'])}),
  action_id TEXT NOT NULL UNIQUE,
  device_id TEXT,
  sent_at TEXT,
  error TEXT
)`;

const INBOX_SYNC = `CREATE TABLE inbox_sync (${RECORD_COLUMNS},
  uid_validity INTEGER,
  last_uid INTEGER,
  last_sync_at TEXT,
  last_count INTEGER,
  last_error TEXT
)`;

const TOOL_GROUPS = `CREATE TABLE tool_groups (
  id TEXT PRIMARY KEY NOT NULL,
  ${booleanColumn('enabled', 0)},
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL,${CONFIRMATION_COLUMNS}
)`;

const ARTIFACTS = `CREATE TABLE artifacts (${OBJECT_COLUMNS},
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  ${jsonColumn('location', false)},
  summary TEXT NOT NULL,
  source_task_id TEXT REFERENCES tasks (id),
  source_message_id TEXT REFERENCES messages (id),
  created_by TEXT NOT NULL,
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  ${jsonColumn('verification', false)}
)`;

const ARTIFACT_VERSIONS = `CREATE TABLE artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES artifacts (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  ${jsonColumn('location', false)},
  bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0),
  sha256 TEXT,
  summary TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
)`;

const NOTE_VERSIONS = `CREATE TABLE note_versions (
  note_id TEXT NOT NULL REFERENCES notes (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  body_file TEXT NOT NULL,
  body_bytes INTEGER NOT NULL CHECK (body_bytes >= 0),
  body_sha256 TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author IN ${inList(['user', 'ai'])}),
  saved_at TEXT NOT NULL,
  PRIMARY KEY (note_id, version)
)`;

const TELEMETRY_SETTINGS = `CREATE TABLE telemetry_settings (${RECORD_COLUMNS},
  ${booleanColumn('enabled', 1)}
)`;

const STATEMENTS = [
  MONEY_CATEGORIES,
  MONEY_ACCOUNTS,
  MONEY_ENTRIES,
  'CREATE INDEX money_entries_occurred ON money_entries (occurred_at)',
  FOCUS_SESSIONS,
  `CREATE UNIQUE INDEX focus_sessions_one_running ON focus_sessions (status) WHERE status = 'running'`,
  'CREATE INDEX focus_sessions_started ON focus_sessions (started_at)',
  REMINDERS,
  'CREATE INDEX reminders_due ON reminders (due_at)',
  INBOX_MESSAGES,
  'CREATE INDEX inbox_messages_received ON inbox_messages (received_at)',
  INBOX_REPLIES,
  'CREATE INDEX inbox_replies_message ON inbox_replies (message_id, created_at)',
  INBOX_SYNC,
  TOOL_GROUPS,
  ARTIFACTS,
  'CREATE INDEX artifacts_task ON artifacts (source_task_id)',
  ARTIFACT_VERSIONS,
  NOTE_VERSIONS,
  TELEMETRY_SETTINGS,
];

export const migration: Migration = {
  id: '0012-life-inbox-artifacts',
  up(db) {
    for (const statement of STATEMENTS) {
      db.exec(statement);
    }
  },
};
