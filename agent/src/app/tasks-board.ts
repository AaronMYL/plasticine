// /v2/tasks（shared/api/tasks-board.ts）：任务栏目第二栏的列表和主区（《优化清单》第 3、4、5 条）。
// 在做 = 正在跑（和排着队）的后台线；等你 = 等他定的卡；定时 = 所有到点自己跑的事（定时线、订阅、回顾、做梦、心跳）；
// 建议 = 摆着的建议卡；项目列在最下面。只列线和定时任务，不列每一次运行（定时线的每一次不进「刚做完」）。
// 项目页用同一份数据（?projectId=）：没归项目的定时、建议算「个人」。

import {
  STANDING_PROJECT_IDS,
  type Ask,
} from '../../shared/state.ts';
import {
  TASKS_DELETED_MAX,
  taskEnded,
  taskInProgress,
  TASKS_ENDED_MAX,
  type LineView,
  type SuggestionView,
  type TaskCounts,
  type TasksBoardResponse,
  type TeammateView,
  type TimedRowView,
} from '../../shared/api/index.ts';
import type { Suggestion } from '../../shared/state.ts';
import { askView, lineOf } from './asks.ts';
import type { AppDeps } from './context.ts';
import { projectHue } from './project-tag.ts';

// 后台线一次最多读这么多条来分在做 / 刚做完：「刚做完」只要最近几条，在做最多 3 条在跑加排队的。
const LINES_SCAN = 200;


export function suggestionView(suggestion: Suggestion): SuggestionView {
  return { id: suggestion.id, title: suggestion.title, why: suggestion.why, icon: suggestion.icon,
    source: suggestion.source, projectId: suggestion.projectId, createdAt: suggestion.createdAt };
}

interface Parts {
  running: LineView[];
  waiting: Ask[];
  ended: LineView[];
  deleted: LineView[];
  timed: TimedRowView[];
  ideas: Suggestion[];
  teammates: TeammateView[];
}

function personal(projectId: string | null): string {
  return projectId ?? STANDING_PROJECT_IDS.personal;
}

function collect(deps: AppDeps): Parts & { lineProject: Map<string, string | null> } {
  const lines = deps.lines.list({ kind: 'background', limit: LINES_SCAN });
  const lineProject = new Map(lines.map((line) => [line.id, line.projectId]));
  const timed = deps.tasks.timed.rows();
  const timedLines = new Set(timed.map((row) => row.lineId).filter((id): id is string => id !== null));
  const board = deps.desk.board();
  const waiting = board.current === null ? board.queue : [board.current, ...board.queue];
  const newest = (a: LineView, b: LineView): number => b.updatedAt.localeCompare(a.updatedAt);
  const done = lines.filter((line) => taskEnded(line) && !timedLines.has(line.id)).sort(newest);
  const deleted = deps.lines.list({ kind: 'background', includeArchived: true, limit: LINES_SCAN })
    .filter((line) => line.archivedAt != null).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  for (const line of deleted) lineProject.set(line.id, line.projectId);
  return { lineProject, running: lines.filter(taskInProgress), waiting, ended: done, deleted, timed,
    ideas: deps.tasks.suggestions.open(), teammates: deps.tasks.timed.teammates() };
}

function forProject(parts: Parts & { lineProject: Map<string, string | null> }, projectId: string): Parts {
  const askProject = (ask: Ask): string | null => {
    const lineId = lineOf(ask);
    return lineId === null ? null : parts.lineProject.get(lineId) ?? null;
  };
  const timed = parts.timed.filter((row) => row.projectId === projectId);
  const mates = new Set(timed.map((row) => row.teammateId));
  return {
    running: parts.running.filter((line) => personal(line.projectId) === projectId),
    waiting: parts.waiting.filter((ask) => askProject(ask) === projectId),
    ended: parts.ended.filter((line) => personal(line.projectId) === projectId),
    deleted: parts.deleted.filter((line) => personal(line.projectId) === projectId),
    timed,
    ideas: parts.ideas.filter((idea) => personal(idea.projectId) === projectId),
    teammates: parts.teammates.filter((mate) => mates.has(mate.id)),
  };
}

function counts(parts: Parts): TaskCounts {
  return { running: parts.running.length, waiting: parts.waiting.length, ended: parts.ended.length,
    deleted: parts.deleted.length, timed: parts.timed.length,
    ideas: parts.ideas.length };
}

/** 任务栏目：全部，或只给一个项目的那部分。 */
export function tasksBoard(deps: AppDeps, projectId: string | null): TasksBoardResponse {
  const all = collect(deps);
  const projects = deps.state.projects.all().filter((project) => project.lifecycle === 'active')
    .map((project) => ({ id: project.id, name: project.name, hue: projectHue(project.id),
      counts: counts(forProject(all, project.id)) }));
  const parts = projectId === null ? all : forProject(all, projectId);
  return {
    projectId,
    counts: counts(parts),
    running: parts.running,
    waiting: parts.waiting.map((ask) => askView(deps.state, ask)),
    ended: parts.ended.slice(0, TASKS_ENDED_MAX),
    deleted: parts.deleted.slice(0, TASKS_DELETED_MAX),
    timed: parts.timed,
    ideas: parts.ideas.map(suggestionView),
    teammates: parts.teammates,
    projects,
  };
}
