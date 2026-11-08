// 存着的项目 → 项目页的视图（shared/api/projects.ts）。只做挑字段和拼接：待办是 project_items 里的 todo 行，在做是挂在
// 这个项目下的线，资料是笔记和链接，动态是项目自己的事。关切、任务、节点 2026-11-05 删掉，那几个字段给空数组。

import {
  PROJECT_HEALTH_LABELS,
  type ProjectActivityView,
  type ProjectDecisionView,
  type ProjectDetail,
  type ProjectLineView,
  type ProjectMaterialView,
  type ProjectRowView,
  type ProjectTodoView,
} from '../../shared/api/index.ts';
import type { LineStatus } from '../../shared/api/lines.ts';
import type { Actor, Ask, Project, ProjectItem } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { LineRow, StateService } from '../state/index.ts';
import { projectHue } from './project-tag.ts';

export type ProjectViewState = Pick<StateService, 'projects' | 'asks' | 'notes' | 'lines' | 'memoryDocs'>;

// 详情的动态只给最近这些。
const ACTIVITY_MAX = 30;
// 详情里的线只给最近这些（全部在线列表里）。
const LINES_MAX = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const WORKING: readonly LineStatus[] = ['running', 'waiting', 'paused'];
const LINE_RUN_PREFIX = 'line:';

interface Members {
  items: ProjectItem[];
  todos: ProjectItem[];
  lines: LineRow[];
}

export interface ViewContext {
  now: Date;
  timeZone: string;
}

function membersOf(state: ProjectViewState, project: Project): Members {
  const items = state.projects.items.forProject(project.id);
  const lines = state.lines.list({ projectId: project.id, limit: Number.MAX_SAFE_INTEGER });
  return { items, todos: items.filter((item) => item.targetType === 'todo'), lines };
}

function daysUntil(day: string | null, context: ViewContext): number | null {
  if (day === null) {
    return null;
  }
  const today = Date.parse(`${localDay(context.now, context.timeZone)}T00:00:00Z`);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - today) / DAY_MS);
}

function latest(times: readonly string[]): string {
  return times.reduce((max, time) => (time > max ? time : max));
}

/** 等你的：这个项目下的线问你、还没答的卡。 */
function waitingOnYou(members: Members, openAsks: readonly Ask[]): number {
  const lineIds = new Set(members.lines.map((line) => `${LINE_RUN_PREFIX}${line.id}`));
  return openAsks.filter((ask) => ask.runId !== null && lineIds.has(ask.runId)).length;
}

function rowOf(project: Project, members: Members, context: ViewContext, openAsks: readonly Ask[],
  state: ProjectViewState): ProjectRowView {
  const events = state.projects.events.recent(project.id, 1);
  const touchedAt = latest([
    project.updatedAt,
    ...members.items.map((item) => item.doneAt ?? item.createdAt),
    ...members.lines.map((line) => line.updatedAt),
    ...events.map((event) => event.createdAt),
  ]);
  return {
    id: project.id,
    name: project.name,
    hue: projectHue(project.id),
    standing: project.standing,
    lifecycle: project.lifecycle,
    health: project.health,
    proposedHealth: project.proposedHealth,
    status: project.status,
    next: project.next,
    due: project.due,
    dueInDays: daysUntil(project.due, context),
    todosDone: members.todos.filter((todo) => todo.doneAt !== null).length,
    todosTotal: members.todos.length,
    running: members.lines.filter((line) => WORKING.includes(line.status)).length,
    waitingOnYou: waitingOnYou(members, openAsks),
    touchedAt,
    version: project.version,
  };
}

export function projectRowView(state: ProjectViewState, project: Project, context: ViewContext): ProjectRowView {
  return rowOf(project, membersOf(state, project), context, state.asks.open(), state);
}

export function projectRows(state: ProjectViewState, projects: readonly Project[], context: ViewContext) {
  const openAsks = state.asks.open();
  return projects.map((project) => rowOf(project, membersOf(state, project), context, openAsks, state));
}

export function todoView(item: ProjectItem, context: ViewContext): ProjectTodoView {
  return {
    id: item.id,
    title: item.title ?? '',
    due: item.due,
    dueInDays: daysUntil(item.due, context),
    doneAt: item.doneAt,
    createdAt: item.createdAt,
  };
}

/** 没做完的在前：有期限的按期限，没期限的按加的先后；做完的在后，最近做完的在前。 */
function todosOf(members: Members, context: ViewContext): ProjectTodoView[] {
  const open = members.todos.filter((todo) => todo.doneAt === null)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  const done = members.todos.filter((todo) => todo.doneAt !== null)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return [...open, ...done].map((todo) => todoView(todo, context));
}

function linesOf(members: Members): ProjectLineView[] {
  return members.lines.slice(0, LINES_MAX)
    .map((line) => ({ id: line.id, title: line.title, status: line.status, updatedAt: line.updatedAt }));
}

function materialsOf(state: ProjectViewState, members: Members): ProjectMaterialView[] {
  return members.items.flatMap((item): ProjectMaterialView[] => {
    if (item.targetType === 'link') {
      return [{ kind: 'link', ref: item.targetId, title: item.title ?? item.targetId, at: item.createdAt }];
    }
    if (item.targetType === 'note') {
      const note = state.notes.get(item.targetId);
      return note === undefined ? [] : [{ kind: 'note', ref: note.id, title: note.title, at: note.updatedAt }];
    }
    return [];
  });
}

function sourceOf(actor: Actor): ProjectActivityView['source'] {
  if (actor === 'user') {
    return 'user';
  }
  return actor === 'brain' || actor === 'hand' ? 'plasticine' : 'system';
}

function activityOf(state: ProjectViewState, project: Project): ProjectActivityView[] {
  return state.projects.events.recent(project.id, ACTIVITY_MAX).map((event) => ({
    at: event.createdAt,
    text: event.text,
    source: sourceOf(event.actor),
  }));
}

/** 项目文档「决定」段里还在用的那几条；原话取第一条指向消息的锚点。 */
function decisionsOf(state: ProjectViewState, project: Project): ProjectDecisionView[] {
  const doc = state.memoryDocs.docs.forProject(project.id);
  if (doc === undefined) {
    return [];
  }
  return state.memoryDocs.lines.live(doc.id).filter((line) => line.section === 'decision').map((line) => ({
    id: line.id,
    text: line.text,
    quoteRef: line.anchors.find((anchor) => anchor.kind === 'message')?.ref ?? null,
    at: line.createdAt,
  }));
}

export function projectDetailView(state: ProjectViewState, project: Project, context: ViewContext): ProjectDetail {
  const members = membersOf(state, project);
  return {
    project: rowOf(project, members, context, state.asks.open(), state),
    brief: project.brief,
    decisions: decisionsOf(state, project),
    people: project.people,
    todos: todosOf(members, context),
    lines: linesOf(members),
    materials: materialsOf(state, members),
    activity: activityOf(state, project),
  };
}

export function healthText(value: Project['health']): string {
  return value === null ? '未定' : PROJECT_HEALTH_LABELS[value];
}
