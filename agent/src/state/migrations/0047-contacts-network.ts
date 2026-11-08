// 联系人与 Cyber Hunter 网络（第 111 条，docs/specs/contacts-network.md 第 5 节）。只加表，旧表一行不动：
// - network_identity：这台实例在网络上的账号（一行 id = 'self'），两对钥匙、收信游标、最近同步；
// - contacts：网络上的人（TOFU 的两把公钥、关系、状态、单独的档位上限、安全码变了没有）；
// - contact_messages：进出的信，出去的那些同时是发件箱（状态、重试次数、下次再试的时间）；
// - network_tasks：跨用户任务；visibility_marks：材料的档位与建议；said_log：分身对外说过的话（只追加）。
// 种类、状态只用 shared/state-network.ts 的 schema 检查，这里不写 CHECK 列表（同 0043），以后加档不改表。
// 中继自己的库是另一个文件 network.sqlite（network-relay/db.ts），不在这里。

import type { Migration } from './migrate.ts';
import { booleanColumn, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const IDENTITY = `CREATE TABLE network_identity (${RECORD_COLUMNS},
  account_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  relay_url TEXT NOT NULL,
  signing_public_key TEXT NOT NULL,
  signing_private_key TEXT NOT NULL,
  encryption_public_key TEXT NOT NULL,
  encryption_private_key TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '0',
  last_sync_at TEXT,
  last_error TEXT
)`;

const CONTACTS = `CREATE TABLE contacts (${RECORD_COLUMNS},
  account_id TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  signing_key TEXT NOT NULL,
  encryption_key TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'stranger',
  state TEXT NOT NULL,
  tier_cap TEXT,
  ${booleanColumn('safety_changed', 0)},
  pending_signing_key TEXT,
  pending_encryption_key TEXT,
  ignored_at TEXT,
  last_at TEXT NOT NULL
)`;

const MESSAGES = `CREATE TABLE contact_messages (${RECORD_COLUMNS},
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  direction TEXT NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  ${jsonColumn('payload', true)},
  exchange_id TEXT,
  task_id TEXT,
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL,
  envelope_id TEXT UNIQUE,
  request_id TEXT UNIQUE,
  read_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  error TEXT
)`;

const TASKS = `CREATE TABLE network_tasks (${RECORD_COLUMNS},
  direction TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  acceptance TEXT NOT NULL,
  deadline TEXT,
  attachment TEXT,
  state TEXT NOT NULL,
  offered_at TEXT NOT NULL,
  request_id TEXT UNIQUE,
  doer TEXT,
  local_task_id TEXT,
  ask_id TEXT,
  decided_at TEXT,
  delivery_text TEXT,
  delivery_at TEXT,
  verdict TEXT,
  verdict_note TEXT,
  verdict_at TEXT
)`;

const MARKS = `CREATE TABLE visibility_marks (${RECORD_COLUMNS},
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  proposed TEXT,
  confirmed_at TEXT,
  UNIQUE (object_kind, object_id)
)`;

const SAID = `CREATE TABLE said_log (
  id TEXT PRIMARY KEY NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contacts (id),
  text TEXT NOT NULL,
  ${jsonColumn('materials', false)},
  exchange_id TEXT,
  message_id TEXT,
  at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0047-contacts-network',
  up(db) {
    for (const statement of [IDENTITY, CONTACTS, MESSAGES, TASKS, MARKS, SAID]) {
      db.exec(statement);
    }
    db.exec('CREATE INDEX contact_messages_contact ON contact_messages (contact_id, sent_at)');
    db.exec('CREATE INDEX contact_messages_outbox ON contact_messages (status, next_attempt_at)');
    db.exec('CREATE INDEX contact_messages_task ON contact_messages (task_id)');
    db.exec('CREATE INDEX network_tasks_contact ON network_tasks (contact_id, offered_at)');
    db.exec('CREATE INDEX network_tasks_local ON network_tasks (local_task_id)');
    db.exec('CREATE INDEX said_log_contact ON said_log (contact_id, at)');
  },
};
