// 假的 /v2/tasks（任务栏目，《优化清单》第 3、4、5 条）：在做 / 刚做完从假线里读，等你从假卡桌读；定时、队友、建议
// 在这里存（本地开发和截图用 tasks-seed.ts 种好设计稿里的样子）。写都按 requestId 幂等，变了推 tasks.changed。

import type { TasksApi } from '../tasks-client.ts';
import { ApiError } from '../errors.ts';
import {
  STANDING_PROJECT_IDS,
  TASKS_DELETED_MAX,
  TASKS_ENDED_MAX,
  taskEnded,
  taskInProgress,
  type DeviceTimeZoneRequest,
  type HeartbeatSayRequest,
  type UpdateHeartbeatRequest,
  type LineView,
  type SuggestionAction,
  type SuggestionActionRequest,
  type SuggestionActionResponse,
  type SuggestionView,
  type TaskCounts,
  type TasksBoardQuery,
  type TasksBoardResponse,
  type TeammateStopRequest,
  type TeammateView,
  type TimedEnableRequest,
  type TimedRemoveRequest,
  type TimedRowView,
} from '../shared.ts';
import type { AskView } from '../types.ts';
import { designHue } from './design-projects.ts';
import type { FakeEventBus } from './event-bus.ts';
import { FakeHeartbeat } from './fake-heartbeat.ts';
import type { FakeAsks } from './fake-asks.ts';
import type { FakeLines } from './fake-lines.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeTasksDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  lines: FakeLines;
  asks: FakeAsks;
  projects: () => { id: string; name: string }[];
}

function notFound(what: string): ApiError {
  return new ApiError({ kind: 'failed', code: 'not_found', message: `没有这个${what}。`, status: 404 });
}

function conflict(message: string): ApiError {
  return new ApiError({ kind: 'conflict', code: 'conflict', message, next: '刷新任务栏目看现在的状态。', status: 409 });
}

const personal = (projectId: string | null): string => projectId ?? STANDING_PROJECT_IDS.personal;

export class FakeTasks implements TasksApi {
  private readonly deps: FakeTasksDeps;
  private timed: TimedRowView[] = [];
  private mates: TeammateView[] = [];
  private ideas: SuggestionView[] = [];
  /** 每台设备最近报的时区。 */
  timeZone: string | null = null;
  /** 心跳的弹层（第 11 条）。 */
  readonly heartbeats = new FakeHeartbeat();

  constructor(deps: FakeTasksDeps) {
    this.deps = deps;
  }

  seed(data: { timed: TimedRowView[]; teammates: TeammateView[]; ideas: SuggestionView[] }): void {
    this.timed = structuredClone(data.timed);
    this.mates = structuredClone(data.teammates);
    this.ideas = structuredClone(data.ideas);
  }

  async board(query: TasksBoardQuery): Promise<TasksBoardResponse> {
    this.deps.session.require();
    const lines = this.deps.lines.all().filter((line) => line.kind === 'background');
    const board = await this.deps.asks.list();
    const waiting = board.current === null ? board.queue : [board.current, ...board.queue];
    const all = this.parts(lines, waiting);
    const projectId = query.projectId ?? null;
    const parts = projectId === null ? all : this.forProject(all, projectId);
    return structuredClone({
      projectId,
      counts: counts(parts),
      running: parts.running,
      waiting: parts.waiting,
      ended: parts.ended.slice(0, TASKS_ENDED_MAX),
      deleted: parts.deleted.slice(0, TASKS_DELETED_MAX),
      timed: parts.timed,
      ideas: parts.ideas,
      teammates: parts.teammates,
      projects: this.deps.projects().map((project) => ({ id: project.id, name: project.name,
        hue: designHue(project.id), counts: counts(this.forProject(all, project.id)) })),
    });
  }

  async setTimedEnabled(body: TimedEnableRequest) {
    this.deps.session.require();
    return this.deps.receipts.run('command', body.requestId, 'POST /v2/tasks/timed/enable', () => {
      const row = this.row(body.rowId);
      if (!row.canToggle) {
        throw conflict('这张定时卡还在等你确认：在对话里的卡上点确认才生效。');
      }
      row.enabled = body.on;
      row.last = body.on ? row.last : { glyph: 'pause', text: '暂停了' };
      if (row.source === 'heartbeat') {
        this.heartbeats.setEnabled(body.on);
      }
      this.changed();
      return { row: structuredClone(row) };
    });
  }

  async removeTimed(body: TimedRemoveRequest) {
    this.deps.session.require();
    return this.deps.receipts.run('command', body.requestId, 'POST /v2/tasks/timed/remove', () => {
      const row = this.row(body.rowId);
      if (!row.canRemove) {
        throw conflict('这一项不能删，只能关掉。');
      }
      this.timed = this.timed.filter((item) => item.id !== row.id);
      this.mates = this.mates.filter((mate) => mate.id !== row.teammateId);
      this.changed();
      return { row: null };
    });
  }

  async stopTeammate(body: TeammateStopRequest) {
    this.deps.session.require();
    return this.deps.receipts.run('command', body.requestId, 'POST /v2/tasks/teammates/stop', () => {
      const mate = this.mates.find((item) => item.id === body.teammateId);
      if (mate === undefined) {
        throw notFound('队友');
      }
      for (const row of this.timed.filter((item) => mate.rowIds.includes(item.id))) {
        row.enabled = false;
      }
      Object.assign(mate, { glyph: 'pause', canStop: false });
      this.changed();
      return { teammate: structuredClone(mate) };
    });
  }

  async suggestion(id: string, action: SuggestionAction, body: SuggestionActionRequest)
    : Promise<SuggestionActionResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('command', body.requestId, `POST /v2/tasks/suggestions/${id}/${action}`, () => {
      const idea = this.ideas.find((item) => item.id === id);
      if (idea === undefined) {
        throw conflict('这条建议已经处理过了。');
      }
      this.ideas = this.ideas.filter((item) => item.id !== id);
      let lineId: string | null = null;
      if (action === 'start') {
        lineId = `line-idea-${id}`;
        this.deps.lines.put(this.deps.lines.blank(lineId, 'background', idea.title,
          { status: 'running', activity: '在想…', projectId: idea.projectId }));
      }
      this.changed();
      return { suggestion: idea, lineId, projectId: action === 'todo' ? personal(idea.projectId) : null };
    });
  }

  async reportTimeZone(body: DeviceTimeZoneRequest) {
    this.deps.session.require();
    this.timeZone = body.timeZone;
    return { timeZone: body.timeZone };
  }

  async heartbeat() {
    this.deps.session.require();
    return this.heartbeats.view();
  }

  async updateHeartbeat(body: UpdateHeartbeatRequest) {
    this.deps.session.require();
    return this.deps.receipts.run('command', body.requestId, 'PUT /v2/heartbeat', () => {
      const { requestId: _requestId, ...change } = body;
      const view = this.heartbeats.update(change);
      this.changed();
      return view;
    });
  }

  async sayToHeartbeat(body: HeartbeatSayRequest) {
    this.deps.session.require();
    const view = this.heartbeats.say(body.text);
    this.changed();
    return view;
  }

  private parts(lines: LineView[], waiting: AskView[]) {
    const timedLines = new Set(this.timed.map((row) => row.lineId));
    const newest = (a: LineView, b: LineView): number => b.updatedAt.localeCompare(a.updatedAt);
    return {
      running: lines.filter(taskInProgress),
      waiting,
      ended: lines.filter((line) => taskEnded(line) && !timedLines.has(line.id)).sort(newest),
      deleted: lines.filter((line) => line.archivedAt != null)
        .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '')),
      timed: this.timed,
      ideas: this.ideas,
      teammates: this.mates,
      lineProject: new Map(lines.map((line) => [line.id, line.projectId])),
    };
  }

  private forProject(all: ReturnType<FakeTasks['parts']>, projectId: string): ReturnType<FakeTasks['parts']> {
    const timed = all.timed.filter((row) => row.projectId === projectId);
    const mates = new Set(timed.map((row) => row.teammateId));
    return {
      ...all,
      running: all.running.filter((line) => personal(line.projectId) === projectId),
      waiting: all.waiting.filter((ask) => ask.lineId !== null && all.lineProject.get(ask.lineId) === projectId),
      ended: all.ended.filter((line) => personal(line.projectId) === projectId),
      deleted: all.deleted.filter((line) => personal(line.projectId) === projectId),
      timed,
      ideas: all.ideas.filter((idea) => personal(idea.projectId) === projectId),
      teammates: all.teammates.filter((mate) => mates.has(mate.id)),
    };
  }

  private row(rowId: string): TimedRowView {
    const row = this.timed.find((item) => item.id === rowId);
    if (row === undefined) {
      throw notFound('定时任务');
    }
    return row;
  }

  private changed(): void {
    this.deps.bus.emit({ type: 'tasks.changed' });
  }
}

function counts(parts: { running: unknown[]; waiting: unknown[]; ended: unknown[]; deleted: unknown[];
  timed: unknown[]; ideas: unknown[] }): TaskCounts {
  return { running: parts.running.length, waiting: parts.waiting.length, ended: parts.ended.length,
    deleted: parts.deleted.length, timed: parts.timed.length, ideas: parts.ideas.length };
}
