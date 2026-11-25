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
