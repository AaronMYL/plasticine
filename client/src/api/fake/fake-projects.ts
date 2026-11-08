// 假的项目：列表（常驻的排最后）、详情（待办带期限、这个项目下的线、资料、动态）、新建、编辑、健康度、归档、待办。
// 写操作按 requestId 幂等，带 version 的过时了回 409（ConflictError），和真服务端（agent/src/app/projects.ts）一样。

import type { ProjectsApi } from '../client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import { PROJECT_HEALTH_LABELS } from '../shared.ts';
import type {
  ProjectDecisionView,
  AddProjectTodoRequest,
  CreateProjectRequest,
  EditProjectRequest,
  FileProjectItemRequest,
  ProjectActivityView,
  ProjectBrief,
  ProjectDetail,
  ProjectListResponse,
  ProjectMaterialView,
  ProjectPerson,
  ProjectQuery,
  ProjectRowView,
  ProjectTodoResponse,
  ProjectTodoView,
  SetProjectHealthRequest,
  EditProjectTodoRequest,
  UnfileProjectItemRequest,
  LineView,
} from '../shared.ts';
import { designHue } from './design-projects.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

const DAY_MS = 86_400_000;
const STALE_NEXT = '看 current 里的最新版，确认后用最新的 version 再来。';

type Row = Omit<ProjectRowView, 'todosDone' | 'todosTotal' | 'waitingOnYou' | 'dueInDays'>;

interface StoredProject {
  row: Row;
  brief: ProjectBrief;
  /** 对话里定下的事（带原话的引用）。 */
  decisions: ProjectDecisionView[];
  people: ProjectPerson[];
  todos: TodoSeed[];
  materials: ProjectMaterialView[];
  activity: ProjectActivityView[];
}

export interface FakeProjectsDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  /** 这个项目下的线（假的线那边按 projectId 挑）；没接上是空的。 */
  lines?: () => readonly LineView[];
  now: () => Date;
}

/** 一条待办存的样子：期限是日子，做完是时间。 */
export interface TodoSeed {
  id: string;
  title: string;
  due: string | null;
  doneAt: string | null;
  createdAt: string;
}

export type ProjectSeed = Pick<Row, 'id' | 'name'> & Partial<Omit<Row, 'id' | 'name'>> &
  Partial<Omit<StoredProject, 'row' | 'todos'>> & { todos?: (Pick<TodoSeed, 'title'> & Partial<TodoSeed>)[] };

function notFound(): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这个项目。', status: 404 });
}

export class FakeProjects implements ProjectsApi {
  private readonly deps: FakeProjectsDeps;
  private readonly projects = new Map<string, StoredProject>();
  private sequence = 0;

  constructor(deps: FakeProjectsDeps) {
    this.deps = deps;
  }

  async list(query: ProjectQuery): Promise<ProjectListResponse> {
    this.deps.session.require();
    const rows = [...this.projects.values()]
      .filter((stored) => query.includeDone === true || stored.row.lifecycle !== 'done')
      .map((stored) => this.view(stored))
      .sort((a, b) => Number(a.standing) - Number(b.standing) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
    const active = rows.filter((row) => row.lifecycle === 'active');
    return {
      projects: rows,
      summary: {
        active: active.length,
        overdue: active.filter((row) => row.dueInDays !== null && row.dueInDays < 0).length,
        dueThisWeek: active.filter((row) => row.dueInDays !== null && row.dueInDays >= 0 && row.dueInDays < 7).length,
      },
    };
  }

  async get(id: string): Promise<ProjectDetail> {
    this.deps.session.require();
    const stored = this.require(id);
    const lines = (this.deps.lines?.() ?? []).filter((line) => line.projectId === id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((line) => ({ id: line.id, title: line.title, status: line.status, updatedAt: line.updatedAt }));
    return {
      project: this.view(stored),
      brief: stored.brief,
      decisions: stored.decisions,
      people: stored.people,
      todos: this.todosOf(stored),
      lines,
      materials: stored.materials,
      activity: stored.activity,
    };
  }

  async create(input: CreateProjectRequest): Promise<ProjectRowView> {
    this.deps.session.require();
    return this.deps.receipts.run('project', input.requestId, 'POST /v2/projects', () => {
      this.sequence += 1;
      const stored = this.seed({ id: `project_new_${this.sequence}`, name: input.name, due: input.due ?? null,
        brief: { goal: input.goal ?? '', constraints: '', rules: '', terms: '' } });
      this.log(stored, `你新建了项目「${input.name}」`);
      return this.view(stored);
    });
  }

  async edit(id: string, input: EditProjectRequest): Promise<ProjectRowView> {
    this.deps.session.require();
    return this.deps.receipts.run('project', input.requestId, `PUT /v2/projects/${id}`, () => {
      const stored = this.writable(id, input.version);
      if (stored.row.standing && input.lifecycle !== undefined && input.lifecycle !== 'active') {
        throw new ApiError({ kind: 'conflict', code: 'conflict', status: 409,
          message: '常驻项目一直在，不能暂停或完成。' });
      }
      const at = this.deps.now().toISOString();
      const status = input.status === undefined ? {}
        : { status: input.status === null ? null : { text: input.status, by: 'user' as const, at } };
      stored.row = {
        ...stored.row,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.due === undefined ? {} : { due: input.due }),
        ...(input.next === undefined ? {} : { next: input.next }),
        ...(input.lifecycle === undefined ? {} : { lifecycle: input.lifecycle }),
        ...status,
      };
      stored.brief = input.brief ?? stored.brief;
      stored.people = input.people ?? stored.people;
      this.log(stored, '你改了项目');
      return this.view(stored);
    });
  }

  async setHealth(id: string, input: SetProjectHealthRequest): Promise<ProjectRowView> {
    this.deps.session.require();
    return this.deps.receipts.run('project', input.requestId, `POST /v2/projects/${id}/health`, () => {
      const stored = this.writable(id, input.version);
      const from = stored.row.health === null ? '未定' : PROJECT_HEALTH_LABELS[stored.row.health];
      stored.row = { ...stored.row, health: input.value, proposedHealth: null };
      this.log(stored, `健康度 ${from} → ${PROJECT_HEALTH_LABELS[input.value]}`);
      return this.view(stored);
    });
  }

  async file(id: string, input: FileProjectItemRequest): Promise<ProjectRowView> {
    this.deps.session.require();
    return this.deps.receipts.run('project', input.requestId, `POST /v2/projects/${id}/items`, () => {
      const stored = this.require(id);
      if (input.targetType === 'link') {
        stored.materials = [...stored.materials, { kind: 'link', ref: input.targetId,
          title: input.title ?? input.targetId, at: this.deps.now().toISOString() }];
      }
      this.log(stored, `归进来：${input.title ?? input.targetId}`);
      return this.view(stored);
    });
  }

  async unfile(id: string, input: UnfileProjectItemRequest): Promise<ProjectRowView> {
    this.deps.session.require();
    return this.deps.receipts.run('project', input.requestId, `POST /v2/projects/${id}/items/remove`, () => {
      const stored = this.require(id);
      if (input.targetType === 'todo') {
        stored.todos = stored.todos.filter((todo) => todo.id !== input.targetId);
      }
      stored.materials = stored.materials.filter((item) => item.ref !== input.targetId);
      this.log(stored, '拿出去了一项');
      return this.view(stored);
    });
  }

  async addTodo(id: string, input: AddProjectTodoRequest): Promise<ProjectTodoResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('project', input.requestId, `POST /v2/projects/${id}/todos`, () => {
      const stored = this.require(id);
      this.sequence += 1;
      const todo: TodoSeed = { id: `todo_new_${this.sequence}`, title: input.title, due: input.due ?? null,
        doneAt: null, createdAt: this.deps.now().toISOString() };
      stored.todos = [...stored.todos, todo];
      this.log(stored, `加了待办：${input.title}`);
      return { project: this.view(stored), todo: this.todoView(todo) };
    });
  }

  async editTodo(id: string, todoId: string, input: EditProjectTodoRequest): Promise<ProjectTodoResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('project', input.requestId, `PUT /v2/projects/${id}/todos/${todoId}`, () => {
      const stored = this.require(id);
      const current = stored.todos.find((todo) => todo.id === todoId);
      if (current === undefined) {
        throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这条待办。', status: 404 });
      }
      const doneAt = input.done === undefined ? current.doneAt
        : input.done ? current.doneAt ?? this.deps.now().toISOString() : null;
      const next: TodoSeed = { ...current, ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.due === undefined ? {} : { due: input.due }), doneAt };
      stored.todos = stored.todos.map((todo) => (todo.id === todoId ? next : todo));
      this.log(stored, input.done === true ? `做完了：${next.title}` : `改了待办：${next.title}`);
      return { project: this.view(stored), todo: this.todoView(next) };
    });
  }

  /** 预置一个项目（本地开发和测试用）。 */
  seed(seed: ProjectSeed): StoredProject {
    const at = this.deps.now().toISOString();
    const stored: StoredProject = {
      row: {
        id: seed.id,
        name: seed.name,
        hue: seed.hue ?? designHue(seed.id),
        standing: seed.standing ?? false,
        lifecycle: seed.lifecycle ?? 'active',
        health: seed.health ?? null,
        proposedHealth: seed.proposedHealth ?? null,
        status: seed.status ?? null,
        next: seed.next ?? null,
        due: seed.due ?? null,
        running: seed.running ?? 0,
        touchedAt: seed.touchedAt ?? at,
        version: 1,
      },
      brief: seed.brief ?? { goal: '', constraints: '', rules: '', terms: '' },
      decisions: seed.decisions ?? [],
      people: seed.people ?? [],
      todos: (seed.todos ?? []).map((todo, index) => ({ id: todo.id ?? `${seed.id}_todo_${index + 1}`,
        title: todo.title, due: todo.due ?? null, doneAt: todo.doneAt ?? null, createdAt: todo.createdAt ?? at })),
      materials: seed.materials ?? [],
      activity: seed.activity ?? [],
    };
    this.projects.set(seed.id, stored);
    return stored;
  }

  /** 没完成的项目的名字（假书签推项目、对文件夹用）。 */
  names(): { id: string; name: string }[] {
    return [...this.projects.values()].filter((stored) => stored.row.lifecycle !== 'done')
      .map((stored) => ({ id: stored.row.id, name: stored.row.name }));
  }

  /** 在进行的项目数（假今日页的「今天的数」用）。 */
  activeCount(): number {
    return [...this.projects.values()].filter((stored) => stored.row.lifecycle === 'active').length;
  }

  /** Plasticine 提议一个健康度（测试和截图用，真服务端由脑写）。 */
  propose(id: string, value: ProjectRowView['health'] & string, reason: string): void {
    const stored = this.require(id);
    stored.row = { ...stored.row, proposedHealth: { value, reason, at: this.deps.now().toISOString() },
      version: stored.row.version + 1 };
  }

  private daysUntil(due: string | null): number | null {
    const today = Date.parse(`${this.deps.now().toISOString().slice(0, 10)}T00:00:00Z`);
    return due === null ? null : Math.round((Date.parse(`${due}T00:00:00Z`) - today) / DAY_MS);
  }

  private todoView(todo: TodoSeed): ProjectTodoView {
    return { id: todo.id, title: todo.title, due: todo.due, dueInDays: this.daysUntil(todo.due), doneAt: todo.doneAt,
      createdAt: todo.createdAt };
  }

  /** 没做完的在前（有期限的按期限），做完的在后，和真服务端同一个顺序。 */
  private todosOf(stored: StoredProject): ProjectTodoView[] {
    const open = stored.todos.filter((todo) => todo.doneAt === null)
      .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
    const done = stored.todos.filter((todo) => todo.doneAt !== null)
      .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    return [...open, ...done].map((todo) => this.todoView(todo));
  }

  private view(stored: StoredProject): ProjectRowView {
    const lines = (this.deps.lines?.() ?? []).filter((line) => line.projectId === stored.row.id);
    return {
      ...stored.row,
      dueInDays: this.daysUntil(stored.row.due),
      todosDone: stored.todos.filter((todo) => todo.doneAt !== null).length,
      todosTotal: stored.todos.length,
      running: lines.filter((line) => line.status === 'running').length,
      waitingOnYou: lines.filter((line) => line.status === 'waiting').length,
    };
  }

  private log(stored: StoredProject, text: string): void {
    const at = this.deps.now().toISOString();
    stored.activity = [{ at, text, source: 'user' }, ...stored.activity];
    stored.row = { ...stored.row, touchedAt: at, version: stored.row.version + 1 };
    this.deps.bus.emit({ type: 'project.invalidated', projectId: stored.row.id });
  }

  private require(id: string): StoredProject {
    const stored = this.projects.get(id);
    if (stored === undefined) {
      throw notFound();
    }
    return stored;
  }

  private writable(id: string, version: number): StoredProject {
    const stored = this.require(id);
    if (stored.row.version !== version) {
      throw new ConflictError(this.view(stored), '这个项目在别处改过了，这次没有改。', STALE_NEXT);
    }
    return stored;
  }
}

