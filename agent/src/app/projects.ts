// /v2/projects：项目列表（常驻的两个排最后）、一个项目的详情、新建、编辑、健康度（只有用户写）、归档与拿出、待办。
// 每个写操作按 requestId 幂等、带它画出来时的 version，过时就 409 带现在的项目；每次改动在项目动态里记一笔。

import {
  AddProjectTodoRequestSchema,
  CreateProjectRequestSchema,
  DEFAULT_TIME_ZONE,
  EditProjectRequestSchema,
  EditProjectTodoRequestSchema,
  FileProjectItemRequestSchema,
  PROJECT_HEALTH_LABELS,
  PROJECT_LIFECYCLE_LABELS,
  ProjectQuerySchema,
  SetProjectHealthRequestSchema,
  UnfileProjectItemRequestSchema,
  type ProjectListResponse,
  type ProjectResponse,
  type ProjectTodoResponse,
} from '../../shared/api/index.ts';
import type { Project, ProjectItem, ProjectPatch } from '../../shared/state.ts';
import { StateError, type TodoPatch } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, type AppDeps, type AuthContext, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, type AfterCommit } from './idempotency.ts';
import { projectDetailView, projectRows, projectRowView, todoView, type ViewContext } from './project-views.ts';
import { checkInput, queryObject } from './validate.ts';

const LIFECYCLE_ORDER: readonly Project['lifecycle'][] = ['active', 'paused', 'done'];
// 「本周到期」：今天起 7 天内。
const WEEK_DAYS = 7;

function viewContext(deps: AppDeps, timeZone: string | undefined): ViewContext {
  return { now: deps.now(), timeZone: timeZone ?? DEFAULT_TIME_ZONE };
}

function requireProject(deps: AppDeps, id: string): Project {
  const project = deps.state.projects.get(id);
  if (project === undefined) {
    throw notFoundError('这个项目');
  }
  return project;
}

/** A version conflict answered with the project as it is now. */
function withCurrent<T>(deps: AppDeps, id: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (!(error instanceof StateError) || error.code !== 'version_conflict') {
      throw error;
    }
    const current = deps.state.projects.require(id);
    throw new ApiError(409, 'version_conflict', '这个项目在别处改过了，这次没有改。', {
      currentVersion: current.version,
      next: '看 current 里的最新版，确认后用最新的 version 再来。',
      extra: { current: projectRowView(deps.state, current, viewContext(deps, undefined)) },
    });
  }
}

function record(deps: AppDeps, auth: AuthContext, project: Project, kind: 'created' | 'edited' | 'health' | 'filed'
  | 'unfiled' | 'status', text: string, afterCommit: AfterCommit): void {
  deps.state.projects.events.add({ projectId: project.id, kind, text,
    actor: auth.actor === 'system' ? 'system' : 'user', actorRef: auth.device.id });
  afterCommit(() => deps.hub.publish({ type: 'project_invalidated', projectId: project.id }));
}

function answer(deps: AppDeps, id: string, status = 200): Reply {
  const project = deps.state.projects.require(id);
  const body: ProjectResponse = { project: projectRowView(deps.state, project, viewContext(deps, undefined)) };
  return { status, body };
}

function listOrder(a: Project, b: Project): number {
  const standing = Number(a.standing) - Number(b.standing);
  if (standing !== 0) {
    return standing;
  }
  const lifecycle = LIFECYCLE_ORDER.indexOf(a.lifecycle) - LIFECYCLE_ORDER.indexOf(b.lifecycle);
  return lifecycle !== 0 ? lifecycle : (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.name.localeCompare(b.name);
}

/** GET /v2/projects?tz=&includeDone= */
export function listProjects(context: RequestContext): Reply {
  requireAuth(context);
  const types = { includeDone: 'boolean' } as const;
  const query = checkInput(ProjectQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const { deps } = context;
  const all = deps.state.projects.all();
  const shown = all.filter((project) => query.includeDone === true || project.lifecycle !== 'done').sort(listOrder);
  const rows = projectRows(deps.state, shown, viewContext(deps, query.tz));
  const active = rows.filter((row) => row.lifecycle === 'active');
  const body: ProjectListResponse = {
    projects: rows,
    summary: {
      active: active.length,
      overdue: active.filter((row) => row.dueInDays !== null && row.dueInDays < 0).length,
      dueThisWeek: active.filter((row) => row.dueInDays !== null && row.dueInDays >= 0 && row.dueInDays < WEEK_DAYS)
        .length,
    },
  };
  return { status: 200, body };
}

/** GET /v2/projects/:id?tz= */
export function getProject(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(ProjectQuerySchema, queryObject(context.url.searchParams, {}), '查询参数');
  const { deps } = context;
  const project = requireProject(deps, param(context, 'id'));
  return { status: 200, body: projectDetailView(deps.state, project, viewContext(deps, query.tz)) };
}

/** POST /v2/projects */
export async function createProject(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(CreateProjectRequestSchema, await readJsonBody(context.req), '新建项目');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const brief = { goal: body.goal ?? '', constraints: '', rules: '', terms: '' };
    const project = deps.state.projects.create({ name: body.name, due: body.due ?? null, brief });
    record(deps, auth, project, 'created', `你新建了项目「${body.name}」`, afterCommit);
    return answer(deps, project.id, 201);
  });
}

function editText(current: Project, patch: ProjectPatch): string {
  const parts: string[] = [];
  if (patch.name !== undefined && patch.name !== current.name) {
    parts.push(`改名为「${patch.name}」`);
  }
  if (patch.due !== undefined && patch.due !== current.due) {
    parts.push(patch.due === null ? '去掉了截止' : `截止改到 ${patch.due}`);
  }
  if (patch.lifecycle !== undefined && patch.lifecycle !== current.lifecycle) {
    parts.push(`标成「${PROJECT_LIFECYCLE_LABELS[patch.lifecycle]}」`);
  }
  if (patch.next !== undefined) {
    parts.push(patch.next === null ? '清掉了下一步' : `下一步：${patch.next}`);
  }
  if (patch.status !== undefined && patch.status !== null) {
    parts.push(`现状：${patch.status.text}`);
  }
  if (patch.brief !== undefined) {
    parts.push('改了项目档案');
  }
  if (patch.people !== undefined) {
    parts.push('改了分工');
  }
  return parts.length === 0 ? '你改了项目' : `你${parts.join('；')}`;
}

/** PUT /v2/projects/:id */
export async function editProject(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(EditProjectRequestSchema, await readJsonBody(context.req), '编辑项目');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const current = requireProject(deps, id);
    if (current.standing && body.lifecycle !== undefined && body.lifecycle !== 'active') {
      throw new ApiError(409, 'conflict', '常驻项目一直在，不能暂停或完成。', { next: '需要的话改它的档案或下一步。' });
    }
    const written = body.status === undefined || body.status === null ? null
      : { text: body.status, by: auth.actor === 'system' ? 'brain' as const : 'user' as const,
        at: deps.now().toISOString() };
    const status = body.status === undefined ? {} : { status: written };
    const patch: ProjectPatch = {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.due === undefined ? {} : { due: body.due }),
      ...(body.next === undefined ? {} : { next: body.next }),
      ...status,
      ...(body.brief === undefined ? {} : { brief: body.brief }),
      ...(body.people === undefined ? {} : { people: body.people }),
      ...(body.lifecycle === undefined ? {} : { lifecycle: body.lifecycle }),
    };
    const project = withCurrent(deps, id, () => deps.state.projects.update(id, body.version, patch));
    record(deps, auth, project, body.status === undefined ? 'edited' : 'status', editText(current, patch), afterCommit);
    return answer(deps, id);
  });
}

/** POST /v2/projects/:id/health — 只有这里写 health：用户采纳提议或另选一档；提议随之清掉。 */
export async function setProjectHealth(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(SetProjectHealthRequestSchema, await readJsonBody(context.req), '健康度');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const current = requireProject(deps, id);
    const patch: ProjectPatch = { health: body.value, healthAt: deps.now().toISOString(), proposedHealth: null };
    const project = withCurrent(deps, id, () => deps.state.projects.update(id, body.version, patch));
    const from = current.health === null ? '未定' : PROJECT_HEALTH_LABELS[current.health];
    record(deps, auth, project, 'health', `健康度 ${from} → ${PROJECT_HEALTH_LABELS[body.value]}`, afterCommit);
    return answer(deps, id);
  });
}

function itemLabel(deps: AppDeps, item: ProjectItem): string {
  if (item.targetType === 'note') {
    return deps.state.notes.get(item.targetId)?.title ?? item.targetId;
  }
  return item.title ?? item.targetId;
}

/** 要归档的这一项读得到就返回它的标题（链接返回地址），读不到就 404。 */
function requireTarget(deps: AppDeps, targetType: 'note' | 'link', targetId: string): string {
  if (targetType === 'link') {
    if (!URL.canParse(targetId) || !/^https?:$/.test(new URL(targetId).protocol)) {
      throw new ApiError(400, 'invalid_request', '链接要是 http 或 https 开头的完整地址。', { field: 'targetId' });
    }
    return targetId;
  }
  const title = deps.state.notes.get(targetId)?.title;
  if (title === undefined) {
    throw notFoundError('要归档的这一项');
  }
  return title;
}

/** POST /v2/projects/:id/items */
export async function fileProjectItem(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(FileProjectItemRequestSchema, await readJsonBody(context.req), '归到项目');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const project = requireProject(deps, id);
    const label = requireTarget(deps, body.targetType, body.targetId);
    const title = body.targetType === 'link' ? body.title ?? body.targetId : null;
    const previousId = deps.state.projects.items.find(body.targetType, body.targetId)?.projectId;
    deps.state.projects.items.file({ projectId: id, targetType: body.targetType, targetId: body.targetId, title,
      addedBy: auth.actor === 'system' ? 'system' : 'user',
      reason: auth.actor === 'system' ? 'Plasticine 归进来的' : '你归进来的' });
    record(deps, auth, project, 'filed', `归进来：${title ?? label}`, afterCommit);
    if (previousId !== undefined && previousId !== id) {
      afterCommit(() => deps.hub.publish({ type: 'project_invalidated', projectId: previousId }));
    }
    return answer(deps, id);
  });
}

/** POST /v2/projects/:id/items/remove */
export async function unfileProjectItem(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(UnfileProjectItemRequestSchema, await readJsonBody(context.req), '从项目拿出');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const project = requireProject(deps, id);
    const item = deps.state.projects.items.find(body.targetType, body.targetId);
    if (item === undefined || item.projectId !== id) {
      throw notFoundError('这个项目里的这一项');
    }
    deps.state.projects.items.unfile(body.targetType, body.targetId);
    const verb = body.targetType === 'todo' ? '删了待办' : '拿出去了';
    record(deps, auth, project, 'unfiled', `${verb}：${itemLabel(deps, item)}`, afterCommit);
    return answer(deps, id);
  });
}

function todoAnswer(deps: AppDeps, projectId: string, todoId: string, status = 200): Reply {
  const project = deps.state.projects.require(projectId);
  const todo = deps.state.projects.items.get(todoId)!;
  const context = viewContext(deps, undefined);
  const body: ProjectTodoResponse = { project: projectRowView(deps.state, project, context),
    todo: todoView(todo, context) };
  return { status, body };
}

/** POST /v2/projects/:id/todos */
export async function addProjectTodo(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(AddProjectTodoRequestSchema, await readJsonBody(context.req), '加待办');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const project = requireProject(deps, id);
    const todo = deps.state.projects.items.addTodo({ projectId: id, title: body.title, due: body.due ?? null,
      addedBy: auth.actor === 'system' ? 'system' : 'user',
      reason: auth.actor === 'system' ? 'Plasticine 加的' : '你加的' });
    const due = todo.due === null ? '' : `（${todo.due} 前）`;
    record(deps, auth, project, 'filed', `加了待办：${body.title}${due}`, afterCommit);
    return todoAnswer(deps, id, todo.id, 201);
  });
}

function todoEditText(current: ProjectItem, patch: TodoPatch): string {
  if (patch.doneAt !== undefined && patch.doneAt !== current.doneAt) {
    return patch.doneAt === null ? `重新打开待办：${current.title ?? ''}` : `做完了：${current.title ?? ''}`;
  }
  if (patch.due !== undefined && patch.due !== current.due) {
    return patch.due === null ? `去掉了待办的期限：${current.title ?? ''}` : `待办期限改到 ${patch.due}：${current.title ?? ''}`;
  }
  return `改了待办：${patch.title ?? current.title ?? ''}`;
}

/** PUT /v2/projects/:id/todos/:todoId */
export async function editProjectTodo(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(EditProjectTodoRequestSchema, await readJsonBody(context.req), '改待办');
  const id = param(context, 'id');
  const todoId = param(context, 'todoId');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const project = requireProject(deps, id);
    const current = deps.state.projects.items.get(todoId);
    if (current === undefined || current.projectId !== id || current.targetType !== 'todo') {
      throw notFoundError('这个项目里的这条待办');
    }
    const done = body.done === undefined || body.done === (current.doneAt !== null) ? {}
      : { doneAt: body.done ? deps.now().toISOString() : null };
    const patch: TodoPatch = {
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.due === undefined ? {} : { due: body.due }),
      ...done,
    };
    deps.state.projects.items.editTodo(todoId, patch);
    record(deps, auth, project, 'edited', todoEditText(current, patch), afterCommit);
    return todoAnswer(deps, id, todoId);
  });
}
