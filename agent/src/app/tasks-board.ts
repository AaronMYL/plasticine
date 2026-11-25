import { STANDING_PROJECT_IDS, type Ask, type Suggestion } from '../../shared/state.ts';
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
import { askView, lineOf } from './asks.ts';
import type { AppDeps } from './context.ts';
import { projectHue } from './project-tag.ts';

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
  const waiting = (board.current === null ? board.queue : [board.current, ...board.queue])
    .filter((ask) => ask.purpose !== 'network_reply');
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
    timers: (deps.lineTimers?.views() ?? []).filter((timer) => projectId === null
      || deps.state.lines.get(timer.lineId)?.projectId === projectId),
  };
}
