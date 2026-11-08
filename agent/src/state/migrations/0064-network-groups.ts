// 网络第二批（2026-11-05 他定：@ 某人的 AI、群聊、任务卡两个入口、头像、加好友）。只加表、加列，旧行不动：
// - lines.sealed_prompt：替别人答问题的线（network/responder.ts）自带系统提示、不给工具；平常的线是 NULL。
// - net_responses：哪条线在答哪个问题（一对一的、群里的），线停下以后照它把回答发回去或出卡给主人。
// - net_groups / net_group_members / group_messages：群（端到端：发件方给每个成员各发一封，发件箱的那几行带
//   group_id，不进一对一的聊天）。group_tasks：群里的任务卡（指给某人，或全群谁先接谁做）。
// - network_tasks.group_id：群任务被接下以后，发起人和接的人之间照常走一对一的任务（这一列让它画在群里）。
// - network_identity.avatar / contacts.avatar：头像（data URL，加密随资料发给联系人）。
// 种类、状态照 0047 只用 schema 检查，不写 CHECK 列表。

import type { Migration } from './migrate.ts';
import { booleanColumn, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const RESPONSES = `CREATE TABLE net_responses (${RECORD_COLUMNS},
  line_id TEXT NOT NULL UNIQUE REFERENCES lines (id),
  origin TEXT NOT NULL,
  mode TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts (id),
  group_id TEXT,
  question_id TEXT NOT NULL,
  exchange_id TEXT NOT NULL,
  ${booleanColumn('asker_is_ai', 0)},
  ${jsonColumn('materials', false)},
  status TEXT NOT NULL,
  settled_at TEXT
)`;

const GROUPS = `CREATE TABLE net_groups (${RECORD_COLUMNS},
  owner_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  left_at TEXT,
  last_at TEXT NOT NULL
)`;

const MEMBERS = `CREATE TABLE net_group_members (
  group_id TEXT NOT NULL REFERENCES net_groups (id),
  account_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY (group_id, account_id)
)`;

const GROUP_MESSAGES = `CREATE TABLE group_messages (${RECORD_COLUMNS},
  group_id TEXT NOT NULL REFERENCES net_groups (id),
  message_id TEXT NOT NULL,
  author_account_id TEXT NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  target_account_id TEXT,
  exchange_id TEXT,
  task_id TEXT,
  sent_at TEXT NOT NULL,
  request_id TEXT UNIQUE,
  read_at TEXT,
  UNIQUE (group_id, message_id)
)`;

const GROUP_TASKS = `CREATE TABLE group_tasks (${RECORD_COLUMNS},
  group_id TEXT NOT NULL REFERENCES net_groups (id),
  owner_account_id TEXT NOT NULL,
  assignee_account_id TEXT,
  claimer_account_id TEXT,
  doer TEXT,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  deadline TEXT,
  attachment TEXT,
  state TEXT NOT NULL,
  claimed_at TEXT,
  offered_at TEXT NOT NULL,
  request_id TEXT UNIQUE
)`;

export const migration: Migration = {
  id: '0064-network-groups',
  up(db) {
    db.exec('ALTER TABLE lines ADD COLUMN sealed_prompt TEXT');
    db.exec('ALTER TABLE network_identity ADD COLUMN avatar TEXT');
    db.exec('ALTER TABLE contacts ADD COLUMN avatar TEXT');
    db.exec('ALTER TABLE network_tasks ADD COLUMN group_id TEXT');
    db.exec('ALTER TABLE contact_messages ADD COLUMN group_id TEXT');
    for (const statement of [RESPONSES, GROUPS, MEMBERS, GROUP_MESSAGES, GROUP_TASKS]) {
      db.exec(statement);
    }
    db.exec('CREATE INDEX group_messages_group ON group_messages (group_id, sent_at)');
    db.exec('CREATE INDEX group_tasks_group ON group_tasks (group_id, offered_at)');
    db.exec('CREATE INDEX net_group_members_account ON net_group_members (account_id)');
  },
};
