// 项目（用户 2026-11-01 定：项目取代关切成为界面上的组织单位）。只加表（10-26 第 25 条）：
// - projects：档案、截止、健康度（用户确认的 health 与 Plasticine 提议的 proposed_health 分两列）、分工、一句现状。
// - project_items：挂到项目下的关切 / 任务 / 笔记 / 链接；一样东西只属于一个项目。
// - project_events：项目自己的动态，只追加。
// 健康度、生命周期只用 shared 的 schema 检查，这里不写 CHECK 列表，以后加档不用改表。

import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, OBJECT_COLUMNS } from './sql.ts';

const PROJECTS = `CREATE TABLE projects (${OBJECT_COLUMNS},
  name TEXT NOT NULL,
  ${booleanColumn('standing', 0)},
  lifecycle TEXT NOT NULL,
  due TEXT,
  ${jsonColumn('status', true)},
  next TEXT,
  health TEXT,
  health_at TEXT,
  ${jsonColumn('proposed_health', true)},
  ${jsonColumn('brief', false)},
  ${jsonColumn('people', false)}
)`;

const PROJECT_ITEMS = `CREATE TABLE project_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects (id),
  target_type TEXT NOT NULL CHECK (target_type IN ${inList(['concern', 'task', 'note', 'link'])}),
  target_id TEXT NOT NULL,
  title TEXT,
  added_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (target_type, target_id)
)`;

const PROJECT_EVENTS = `CREATE TABLE project_events (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects (id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_ref TEXT,
  created_at TEXT NOT NULL
)`;

export const migration: Migration = {
  id: '0038-projects',
  up(db) {
    db.exec(PROJECTS);
    db.exec(PROJECT_ITEMS);
    db.exec(PROJECT_EVENTS);
    db.exec('CREATE INDEX project_items_project ON project_items (project_id, created_at)');
    db.exec('CREATE INDEX project_events_project ON project_events (project_id, created_at)');
  },
};
