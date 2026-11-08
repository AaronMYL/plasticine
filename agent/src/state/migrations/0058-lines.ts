// 新内核（2026-11-05 他定：Harness 推倒重做）的「线」：只加表，旧的任务、对话表一行不动。
// - lines：一条线一行。主对话固定一条 main 线（部分唯一索引保证只有一条）；后台线记谁开的它、属于哪个项目。
//   summary / summary_seq 是压缩：seq 不大于 summary_seq 的消息已经写进摘要，送给模型时只带摘要和它之后的消息。
// - line_messages：线里的消息，pi 的消息原样 JSON（user / assistant / toolResult / 本内核的自定义消息），按 seq 排。
// - line_queue：线在跑时发来的话先排在这里，这一轮结束后按顺序发出；「立即发送」插进正在跑的这一轮；撤回只改状态。
// - line_approvals：硬线工具的一次性批准，绑定这次调用（工具名 + 参数摘要），用过就作废。
// - kernel_settings：设备 UUID、默认模型这类一行一个键的设置；kernel_credentials：模型提供商的凭证（每家一行）。
// 种类、状态只用 shared/api/lines.ts 的 schema 检查，这里不写 CHECK 列表（同 0043、0047），以后加状态不改表。

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

// 退出登录不删行：credential 置空（凭证本身不留），行留着记什么时候退的。
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
