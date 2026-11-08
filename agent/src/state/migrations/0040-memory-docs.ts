// 记忆文档（用户 2026-11-02 定，docs/specs/memory-docs.md）。只加表（10-26 第 25 条），memory_entries 一行不动：
// - memory_docs：一个主题一份文档；项目文档和项目一一对应（project_id 唯一）。
// - memory_doc_lines：文档里的行；改 = 新行替代旧行（supersedes / previous），旧行只打退休时间。
// - memory_doc_events：只追加的事件，含两条度量线（用户重说、回复用到）。
// - memory_inferences：拿不准的；status 和 decided_at 是用户确认字段，连同确认它的设备。
// - memory_curation_jobs：每轮后台整理、合并压缩、迁移批次的队列，失败留原因。
// - memory_doc_migration / memory_entry_migrations：一次性迁移的进度和每条旧条目的去向，重跑跳过已迁的。
// 种类、依据、状态只用 shared 的 schema 检查，这里不写 CHECK 列表，以后加档不用改表。

import type { Migration } from './migrate.ts';
import { CONFIRMATION_COLUMNS, jsonColumn, OBJECT_COLUMNS, RECORD_COLUMNS } from './sql.ts';

const DOCS = `CREATE TABLE memory_docs (${OBJECT_COLUMNS},
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  project_id TEXT UNIQUE,
  char_limit INTEGER NOT NULL CHECK (char_limit > 0),
  created_by TEXT NOT NULL,
  retired_at TEXT
)`;

const LINES = `CREATE TABLE memory_doc_lines (${OBJECT_COLUMNS},
  doc_id TEXT NOT NULL REFERENCES memory_docs (id),
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  basis TEXT NOT NULL,
  ${jsonColumn('anchors', false)},
  previous TEXT,
  ${jsonColumn('supersedes', false)},
  inference_id TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  written_by TEXT NOT NULL,
  written_ref TEXT,
  retired_at TEXT,
  retired_reason TEXT,
  CHECK ((retired_at IS NULL) = (retired_reason IS NULL))
)`;

const EVENTS = `CREATE TABLE memory_doc_events (
  id TEXT PRIMARY KEY NOT NULL,
  doc_id TEXT,
  line_id TEXT,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_ref TEXT,
  ${jsonColumn('detail', false)},
  created_at TEXT NOT NULL
)`;

const INFERENCES = `CREATE TABLE memory_inferences (${RECORD_COLUMNS},${CONFIRMATION_COLUMNS},
  doc_id TEXT NOT NULL REFERENCES memory_docs (id),
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  why TEXT NOT NULL,
  ${jsonColumn('anchors', false)},
  job_id TEXT,
  status TEXT NOT NULL,
  decided_at TEXT,
  line_id TEXT
)`;

const JOBS = `CREATE TABLE memory_curation_jobs (${RECORD_COLUMNS},
  key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  run_id TEXT,
  chat_id TEXT,
  reply_id TEXT,
  doc_id TEXT,
  ${jsonColumn('source_ids', false)},
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error TEXT,
  ${jsonColumn('result', true)},
  started_at TEXT,
  finished_at TEXT
)`;

const MIGRATION_STATE = `CREATE TABLE memory_doc_migration (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  cutoff TEXT NOT NULL,
  finished_at TEXT
)`;

const ENTRY_MIGRATIONS = `CREATE TABLE memory_entry_migrations (
  entry_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT,
  outcome TEXT NOT NULL,
  target_id TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0040-memory-docs',
  up(db) {
    for (const sql of [DOCS, LINES, EVENTS, INFERENCES, JOBS, MIGRATION_STATE, ENTRY_MIGRATIONS]) {
      db.exec(sql);
    }
    db.exec('CREATE INDEX memory_doc_lines_doc ON memory_doc_lines (doc_id, retired_at, position)');
    db.exec('CREATE INDEX memory_doc_events_kind ON memory_doc_events (kind, created_at)');
    db.exec('CREATE INDEX memory_doc_events_doc ON memory_doc_events (doc_id, created_at)');
    db.exec('CREATE INDEX memory_inferences_status ON memory_inferences (status, created_at)');
    db.exec('CREATE INDEX memory_curation_jobs_status ON memory_curation_jobs (status, kind, created_at)');
  },
};
