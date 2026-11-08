// M2: what the task list, the 要你定卡 and Web Push need (《实施方案》第 9 节 M2; decision 91 ⑤). Only additions:
// three task columns, the step order column, the asks table and the push subscriptions table.

import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const TASK_COLUMNS = [
  // 打勾已看（《UI 方案》第 5 节：没看过的勾是实心）。
  'ALTER TABLE tasks ADD COLUMN seen_at TEXT',
  // 进入已交付 / 部分交付 / 取消的时间：「今天做完的」按它分。
  'ALTER TABLE tasks ADD COLUMN finished_at TEXT',
  // 同一失败签名第 2 次：下一轮必须先换做法（第 76 条）。
  `ALTER TABLE tasks ADD COLUMN ${booleanColumn('replan_required', 0)}`,
  // 计划里的先后，代替 created_at（review-followups：同一毫秒写下的几步顺序会乱）。
  'ALTER TABLE task_steps ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0)',
];

const ASKS = `CREATE TABLE asks (${RECORD_COLUMNS},
  kind TEXT NOT NULL CHECK (kind IN ${inList(['decide', 'confirm', 'approve', 'act'])}),
  purpose TEXT NOT NULL,
  channel TEXT NOT NULL,
  question TEXT NOT NULL,
  detail TEXT,
  ${jsonColumn('options', false)},
  task_id TEXT REFERENCES tasks (id),
  run_id TEXT,
  action_id TEXT UNIQUE,
  ${jsonColumn('context', true)},
  status TEXT NOT NULL CHECK (status IN ${inList(['open', 'answered', 'withdrawn'])}),
  ${jsonColumn('answer', true)},
  answered_at TEXT,
  answered_by_device_id TEXT,
  deferred_at TEXT,
  withdrawn_at TEXT
)`;

// 退订只打 revoked_at，不删行；同一 endpoint 再订阅时这一行重新启用。
const PUSH_SUBSCRIPTIONS = `CREATE TABLE push_subscriptions (${RECORD_COLUMNS},
  device_id TEXT NOT NULL REFERENCES devices (id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  revoked_at TEXT,
  last_sent_at TEXT,
  last_error TEXT
)`;

const INDEXES = [
  'CREATE INDEX asks_status ON asks (status, created_at)',
  'CREATE INDEX asks_task ON asks (task_id)',
  'CREATE INDEX tasks_finished ON tasks (finished_at)',
  'CREATE INDEX push_subscriptions_device ON push_subscriptions (device_id)',
];

export const migration: Migration = {
  id: '0006-tasks-asks',
  up(db) {
    for (const statement of [...TASK_COLUMNS, ASKS, PUSH_SUBSCRIPTIONS, ...INDEXES]) {
      db.exec(statement);
    }
  },
};
