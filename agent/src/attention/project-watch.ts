import type { Project } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';

export type ProjectWatchState = Pick<StateService, 'projects' | 'lines' | 'transaction'>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
export const STALL_DAYS = 14;
const WORKING = ['running', 'waiting', 'paused'] as const;

export interface ProjectWatchOptions {
  state: ProjectWatchState;
  timeZone: string;
  now: () => Date;
  changed?: (projectId: string) => void;
  noticed?: (notice: { projectId: string; title: string; kind: 'overdue' | 'stalled'; actionId: string;
    at: string }) => void;
}

export interface ProjectWatchReport {
  weekly: number;
  overdue: number;
  stalled: number;
}

function lastTouched(state: ProjectWatchState, project: Project): number {
  const events = state.projects.events.recent(project.id, 20).filter((event) => event.kind !== 'weekly').slice(0, 1);
  const items = state.projects.items.forProject(project.id);
  const times = [project.updatedAt, ...events.map((event) => event.createdAt), ...items.map((item) => item.createdAt),
    ...items.flatMap((item) => (item.doneAt === null ? [] : [item.doneAt]))];
  return Math.max(...times.map((time) => Date.parse(time)));
}

function weeklyText(state: ProjectWatchState, project: Project, since: number): string {
  const todos = state.projects.items.forProject(project.id).filter((item) => item.targetType === 'todo');
  const done = todos.filter((item) => item.doneAt !== null).length;
  const working = state.lines.list({ projectId: project.id, statuses: WORKING, limit: Number.MAX_SAFE_INTEGER });
  const moves = state.projects.events.recent(project.id, 50)
    .filter((event) => Date.parse(event.createdAt) >= since && event.kind !== 'weekly').length;
  return `每周现状：待办 ${done} / ${todos.length} · 在做 ${working.length} 条线 · 这周动了 ${moves} 次`;
}

export class ProjectWatch {
  readonly #options: ProjectWatchOptions;

  constructor(options: ProjectWatchOptions) {
    this.#options = options;
  }

  async scan(): Promise<ProjectWatchReport> {
    const { state, now } = this.#options;
    const at = now();
    const active = state.projects.all().filter((project) => project.lifecycle === 'active');
    let weekly = 0;
    for (const project of active) {
      if (this.#writeWeekly(project, at)) {
        weekly += 1;
      }
    }
    const overdue = active.filter((project) => this.#overdue(project, at));
    const stalled = this.stalled(at);
    const week = Math.floor(at.getTime() / WEEK_MS);
    for (const project of overdue) {
      this.#options.noticed?.({ projectId: project.id, title: project.name, kind: 'overdue',
        actionId: `project-overdue:${project.id}:${project.due}`, at: at.toISOString() });
    }
    for (const project of stalled) {
      this.#options.noticed?.({ projectId: project.id, title: project.name, kind: 'stalled',
        actionId: `project-stall:${project.id}:${week}`, at: at.toISOString() });
    }
    return { weekly, overdue: overdue.length, stalled: stalled.length };
  }

  stalled(at: Date): Project[] {
    const { state } = this.#options;
    return state.projects.all().filter((project) => project.lifecycle === 'active' && !project.standing
      && at.getTime() - lastTouched(state, project) >= STALL_DAYS * DAY_MS);
  }

  #overdue(project: Project, at: Date): boolean {
    return project.due !== null && project.due < localDay(at, this.#options.timeZone);
  }

  #writeWeekly(project: Project, at: Date): boolean {
    const { state } = this.#options;
    const since = at.getTime() - WEEK_MS;
    const recentWeekly = state.projects.events.recent(project.id, 50)
      .some((event) => event.kind === 'weekly' && Date.parse(event.createdAt) > since);
    if (recentWeekly || Date.parse(project.createdAt) > since) {
      return false;
    }
    const text = weeklyText(state, project, since);
    state.projects.events.add({ projectId: project.id, kind: 'weekly', text, actor: 'system' });
    this.#options.changed?.(project.id);
    return true;
  }
}
