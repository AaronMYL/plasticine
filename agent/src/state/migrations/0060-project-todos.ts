import type { Row } from '../db.ts';
import type { Migration, MigrationDb } from './migrate.ts';

const PERSONAL_PROJECT_ID = 'project-personal';
const COLLABORATION_CONCERN_ID = 'collaboration';
const TIME_ZONE = 'Asia/Shanghai';
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit',
  day: '2-digit' });

const PROJECT_ITEMS = `CREATE TABLE project_items_new (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects (id),
  target_type TEXT NOT NULL CHECK (target_type IN ('note', 'link', 'todo')),
  target_id TEXT NOT NULL,
  title TEXT,
  added_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  due TEXT CHECK (due IS NULL OR target_type = 'todo'),
  done_at TEXT CHECK (done_at IS NULL OR target_type = 'todo'),
  created_at TEXT NOT NULL,
  UNIQUE (target_type, target_id)
)`;

const PERSONAL_BRIEF = JSON.stringify({ goal: '不属于别的项目的个人目标、习惯与承诺、兴趣关注点。', constraints: '',
  rules: '', terms: '' });

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function rebuildItems(db: MigrationDb): void {
  db.exec(PROJECT_ITEMS);
  db.exec(`INSERT INTO project_items_new (id, project_id, target_type, target_id, title, added_by, reason, created_at)
    SELECT id, project_id, target_type, target_id, title, added_by, reason, created_at FROM project_items
    WHERE target_type IN ('note', 'link')`);
  db.exec('DROP TABLE project_items');
  db.exec('ALTER TABLE project_items_new RENAME TO project_items');
  db.exec('CREATE INDEX project_items_project ON project_items (project_id, created_at)');
}

function dueOf(row: Row): string | null {
  let triggers: unknown;
  try {
    triggers = JSON.parse(text(row, 'triggers'));
  } catch {
    return null;
  }
  if (!Array.isArray(triggers)) {
    return null;
  }
  const times = triggers.flatMap((trigger: unknown) => {
    if (typeof trigger !== 'object' || trigger === null) {
      return [];
    }
    const { kind, at } = trigger as Record<string, unknown>;
    return kind === 'time' && typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? [Date.parse(at)] : [];
  });
  return times.length === 0 ? null : DAY_FORMAT.format(new Date(Math.min(...times)));
}

function ensurePersonal(db: MigrationDb, at: string): void {
  if (db.all('SELECT id FROM projects WHERE id = $id', { id: PERSONAL_PROJECT_ID }).length > 0) {
    return;
  }
  db.run(`INSERT INTO projects (id, created_at, updated_at, version, name, standing, lifecycle, brief, people)
    VALUES ($id, $at, $at, 1, '个人', 1, 'active', $brief, '[]')`,
      { id: PERSONAL_PROJECT_ID, at, brief: PERSONAL_BRIEF });
}

function moveConcerns(db: MigrationDb, filed: ReadonlyMap<string, string>): void {
  const concerns = db.all(`SELECT id, title, lifecycle, triggers, created_at, updated_at FROM concerns
    ORDER BY created_at, id`);
  for (const concern of concerns) {
    const id = text(concern, 'id');
    const closed = concern['lifecycle'] === 'closed';
    const projectId = filed.get(id) ?? (closed ? null : PERSONAL_PROJECT_ID);
    if (id === COLLABORATION_CONCERN_ID || projectId === null) {
      continue;
    }
    if (projectId === PERSONAL_PROJECT_ID) {
      ensurePersonal(db, text(concern, 'created_at'));
    }
    db.run(`INSERT INTO project_items (id, project_id, target_type, target_id, title, added_by, reason, due, done_at,
      created_at) VALUES ($id, $project, 'todo', $id, $title, 'migration', $reason, $due, $done, $at)`, {
      id,
      project: projectId,
      title: text(concern, 'title'),
      reason: '关切并进项目时迁来',
      due: dueOf(concern),
      done: closed ? text(concern, 'updated_at') : null,
      at: text(concern, 'created_at'),
    });
  }
}

export const migration: Migration = {
  id: '0060-project-todos',
  destructive: true,
  up(db) {
    const filed = new Map(db.all("SELECT target_id, project_id FROM project_items WHERE target_type = 'concern'")
      .map((row) => [text(row, 'target_id'), text(row, 'project_id')]));
    rebuildItems(db);
    moveConcerns(db, filed);
  },
};
