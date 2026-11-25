import {
  EMPTY_BRIEF,
  ProjectEventInputSchema,
  ProjectEventSchema,
  ProjectInputSchema,
  ProjectItemInputSchema,
  ProjectItemSchema,
  ProjectPatchSchema,
  ProjectSchema,
  type CreateOptions,
  type Project,
  type ProjectEvent,
  type ProjectEventInput,
  type ProjectInput,
  type ProjectItem,
  type ProjectItemInput,
  type ProjectItemType,
} from '../../shared/state.ts';
import { checked, encodeRow, OBJECT_META_COLUMNS, readRow, type ColumnMap } from './codec.ts';
import type { Row } from './db.ts';
import { fromSqliteError } from './errors.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  name: 'text',
  standing: 'boolean',
  lifecycle: 'text',
  due: 'text',
  status: 'json',
  next: 'text',
  health: 'text',
  healthAt: 'text',
  proposedHealth: 'json',
  brief: 'json',
  people: 'json',
};

const DEFAULTS = {
  standing: false,
  lifecycle: 'active',
  due: null,
  status: null,
  next: null,
  health: null,
  healthAt: null,
  proposedHealth: null,
  brief: EMPTY_BRIEF,
  people: [],
};

const SPEC: StoreSpec<typeof ProjectSchema, typeof ProjectInputSchema, typeof ProjectPatchSchema> = {
  table: 'projects',
  schema: ProjectSchema,
  input: ProjectInputSchema,
  patch: ProjectPatchSchema,
  columns: COLUMNS,
  defaults: DEFAULTS,
};

const ITEM_COLUMNS: ColumnMap = {
  id: 'text',
  projectId: 'text',
  targetType: 'text',
  targetId: 'text',
  title: 'text',
  addedBy: 'text',
  reason: 'text',
  due: 'text',
  doneAt: 'text',
  createdAt: 'text',
};

const EVENT_COLUMNS: ColumnMap = {
  id: 'text',
  projectId: 'text',
  kind: 'text',
  text: 'text',
  actor: 'text',
  actorRef: 'text',
  createdAt: 'text',
};

const FILE_SQL = `INSERT INTO project_items
  (id, project_id, target_type, target_id, title, added_by, reason, due, done_at, created_at)
  VALUES ($id, $project_id, $target_type, $target_id, $title, $added_by, $reason, $due, $done_at, $created_at)
  ON CONFLICT (target_type, target_id) DO UPDATE SET project_id = excluded.project_id, title = excluded.title,
    added_by = excluded.added_by, reason = excluded.reason, due = excluded.due, done_at = excluded.done_at,
    created_at = excluded.created_at`;

export interface TodoPatch {
  title?: string;
  due?: string | null;
  doneAt?: string | null;
}

const EVENT_SQL = `INSERT INTO project_events (id, project_id, kind, text, actor, actor_ref, created_at)
  VALUES ($id, $project_id, $kind, $text, $actor, $actor_ref, $created_at)`;

function createItemStore(context: StoreContext) {
  const read = (rows: Row[]): ProjectItem[] =>
    rows.map((row) => readRow(ProjectItemSchema, ITEM_COLUMNS, row, 'project_items'));
  return {
    file(input: ProjectItemInput): ProjectItem {
      const values = checked(ProjectItemInputSchema, input, 'invalid_input', '写 project_items');
      const row = { id: context.newId(), title: null, due: null, doneAt: null, ...values, createdAt: context.now() };
      try {
        context.db.run(FILE_SQL, encodeRow(ITEM_COLUMNS, row));
      } catch (error) {
        throw fromSqliteError(error, '写 project_items');
      }
      const filed = this.find(values.targetType, values.targetId);
      if (filed === undefined) {
        throw fromSqliteError(new Error('写入后读不到这一条'), '写 project_items');
      }
      return filed;
    },
    addTodo(input: { projectId: string; title: string; due: string | null; addedBy: ProjectItem['addedBy'];
      reason: string }): ProjectItem {
      const id = context.newId();
      const values = checked(ProjectItemInputSchema, { ...input, targetType: 'todo', targetId: id, doneAt: null },
        'invalid_input', '写 project_items 的待办');
      try {
        context.db.run(FILE_SQL, encodeRow(ITEM_COLUMNS, { ...values, id, createdAt: context.now() }));
      } catch (error) {
        throw fromSqliteError(error, '写 project_items 的待办');
      }
      return this.get(id)!;
    },
    unfile(targetType: ProjectItemType, targetId: string): boolean {
      const sql = 'DELETE FROM project_items WHERE target_type = $target_type AND target_id = $target_id';
      return context.db.run(sql, { target_type: targetType, target_id: targetId }) === 1;
    },
    find(targetType: ProjectItemType, targetId: string): ProjectItem | undefined {
      const sql = 'SELECT * FROM project_items WHERE target_type = $target_type AND target_id = $target_id';
      return read(context.db.all(sql, { target_type: targetType, target_id: targetId }))[0];
    },
    get(id: string): ProjectItem | undefined {
      return read(context.db.all('SELECT * FROM project_items WHERE id = $id', { id }))[0];
    },
    editTodo(id: string, patch: TodoPatch): ProjectItem | undefined {
      const current = this.get(id);
      if (current === undefined || current.targetType !== 'todo') {
        return undefined;
      }
      const next = { ...current, ...patch };
      checked(ProjectItemSchema, next, 'invalid_input', '改 project_items 的待办');
      const sql = 'UPDATE project_items SET title = $title, due = $due, done_at = $done_at WHERE id = $id';
      context.db.run(sql, { id, title: next.title, due: next.due, done_at: next.doneAt });
      return this.get(id);
    },
    forProject(projectId: string): ProjectItem[] {
      const sql = 'SELECT * FROM project_items WHERE project_id = $project_id ORDER BY created_at, id';
      return read(context.db.all(sql, { project_id: projectId }));
    },
    all(): ProjectItem[] {
      return read(context.db.all('SELECT * FROM project_items ORDER BY created_at, id', {}));
    },
  };
}

function createEventStore(context: StoreContext) {
  return {
    add(input: ProjectEventInput): ProjectEvent {
      const values = checked(ProjectEventInputSchema, input, 'invalid_input', '写 project_events');
      const event = { actorRef: null, ...values, id: context.newId(), createdAt: context.now() };
      try {
        context.db.run(EVENT_SQL, encodeRow(EVENT_COLUMNS, event));
      } catch (error) {
        throw fromSqliteError(error, '写 project_events');
      }
      return checked(ProjectEventSchema, event, 'corrupt_record', 'project_events 写入的一行');
    },
    recent(projectId: string, limit: number): ProjectEvent[] {
      const sql = `SELECT * FROM project_events WHERE project_id = $project_id
        ORDER BY created_at DESC, id DESC LIMIT $limit`;
      return context.db.all(sql, { project_id: projectId, limit })
        .map((row) => readRow(ProjectEventSchema, EVENT_COLUMNS, row, 'project_events'));
    },
  };
}

export function createProjectStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: store.update.bind(store),
    create: (input: ProjectInput, options: CreateOptions = {}): Project => store.create(input, undefined, options),
    all: (): Project[] => allPages((page) => store.select('1 = 1', {}, page)),
    items: createItemStore(context),
    events: createEventStore(context),
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
