// 项目的定期查看（用户 2026-11-01 定：每周现状 + 逾期 / 停滞提醒）。跟着外环扫描跑，自己判断到没到时候：
// - 每周现状：一个项目七天里没有过「每周现状」就记一条，内容按数据拼（待办做完几件、在做几条线、这周动了几次），
//   动作者记 system——这是系统按记录整理的，不是 Plasticine 的推理；
// - 逾期：在做的项目过了截止，按「项目 + 截止日」只提醒一次；
// - 停滞：在做的非常驻项目连续 STALL_DAYS 天没有任何动静，按「项目 + 第几周」只提醒一次。
// 11-06 定（《优化清单》第 11 条）：逾期、停滞的提醒并进心跳的清单，由心跳统一判断要不要告诉他；这里不再自己发通知，
// 只记触发（noticed）、给心跳读哪些在逾期 / 停滞（overdue / stalled）。

import type { Project } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';

export type ProjectWatchState = Pick<StateService, 'projects' | 'lines' | 'transaction'>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// 两周没动静算停滞：一周可能只是忙别的，两周还没动多半是卡住或忘了。
export const STALL_DAYS = 14;
const WORKING = ['running', 'waiting', 'paused'] as const;

export interface ProjectWatchOptions {
  state: ProjectWatchState;
  timeZone: string;
  now: () => Date;
  changed?: (projectId: string) => void;
  /**
   * 第 102 条事与来源：逾期、停滞同时记一条触发（外部键沿用这条提醒的动作标识，前后只记一次）；提醒照原路发。
   */
  noticed?: (notice: { projectId: string; title: string; kind: 'overdue' | 'stalled'; actionId: string;
    at: string }) => void;
}

export interface ProjectWatchReport {
  weekly: number;
  overdue: number;
  stalled: number;
}

function lastTouched(state: ProjectWatchState, project: Project): number {
  // 系统自己写的每周现状不算动静，否则它一写，项目就永远不「停滞」。
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

  /** 外环每次扫描调一次；没到时候的什么也不做。 */
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

  /** 在做的非常驻项目里连续 STALL_DAYS 天没有任何动静的（心跳读它）。 */
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
    // 刚建的项目先过满一周再写，免得第一天就来一条空的。
    if (recentWeekly || Date.parse(project.createdAt) > since) {
      return false;
    }
    const text = weeklyText(state, project, since);
    state.projects.events.add({ projectId: project.id, kind: 'weekly', text, actor: 'system' });
    this.#options.changed?.(project.id);
    return true;
  }
}
