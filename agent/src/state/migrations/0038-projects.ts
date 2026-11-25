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
