// /v2/tasks 的接口（shared/api/tasks-board.ts）：读任务栏目；定时的开关和删除；叫停一位队友；建议的开始做 / 加成待办 /
// 忽略（他点了才算他的决定：记这台设备和时间）；设备报自己现在的时区。写都带 requestId，重发回同一个结果、不重做。

import {
  DeviceTimeZoneRequestSchema,
  SuggestionActionRequestSchema,
  TasksBoardQuerySchema,
  TeammateStopRequestSchema,
  TimedEnableRequestSchema,
  TimedRemoveRequestSchema,
  type SuggestionAction,
} from '../../shared/api/index.ts';
import { isTimeZone } from '../../shared/time-zone.ts';
import { ScheduleError } from '../tasks/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { suggestionView, tasksBoard } from './tasks-board.ts';
import { checkInput, queryObject } from './validate.ts';

/** 定时、建议的拒绝换成接口的错误：没有 404，状态不对 409。 */
function taskCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (!(error instanceof ScheduleError)) {
      throw error;
    }
    throw error.code === 'not_found' ? new ApiError(404, 'not_found', error.message)
      : new ApiError(409, 'conflict', error.message, { next: '刷新任务栏目看现在的状态。' });
  }
}

/** GET /v2/tasks/board?projectId= */
export function readTasksBoard(context: RequestContext): Reply {
  requireUserAuth(context);
  const query = checkInput(TasksBoardQuerySchema, queryObject(context.url.searchParams, {}), '任务栏目');
  const projectId = query.projectId ?? null;
  if (projectId !== null && context.deps.state.projects.get(projectId) === undefined) {
    throw new ApiError(404, 'not_found', '没有这个项目。');
  }
  return { status: 200, body: tasksBoard(context.deps, projectId) };
}

/** POST /v2/tasks/timed/enable：拨开关（停了不再到点；打开从现在起排）。 */
export async function enableTimed(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(TimedEnableRequestSchema, await readJsonBody(context.req), '定时开关');
  return idempotent(context, input.requestId, () => ({ status: 200,
    body: { row: taskCall(() => context.deps.tasks.timed.setEnabled(input.rowId, input.on)) } }));
}

/** POST /v2/tasks/timed/remove：删（只标记，正在跑的那一轮停下）。 */
export async function removeTimed(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(TimedRemoveRequestSchema, await readJsonBody(context.req), '删定时');
  return idempotent(context, input.requestId, () => {
    taskCall(() => context.deps.tasks.timed.remove(input.rowId));
    return { status: 200, body: { row: null } };
  });
}

/** POST /v2/tasks/teammates/stop：叫停一位队友。 */
export async function stopTeammate(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(TeammateStopRequestSchema, await readJsonBody(context.req), '叫停');
  return idempotent(context, input.requestId, () => ({ status: 200,
    body: { teammate: taskCall(() => context.deps.tasks.timed.stop(input.teammateId)) } }));
}

async function suggestionAction(context: RequestContext, action: SuggestionAction): Promise<Reply> {
  const auth = requireUserAuth(context);
  const input = checkInput(SuggestionActionRequestSchema, await readJsonBody(context.req), '建议');
  const id = param(context, 'id');
  const desk = context.deps.tasks.suggestions;
  return idempotent(context, input.requestId, () => taskCall(() => {
    const at = context.deps.now().toISOString();
    const device = auth.device.id;
    if (action === 'start') {
      const { suggestion, lineId } = desk.start(id, device, at);
      return { status: 200, body: { suggestion: suggestionView(suggestion), lineId, projectId: suggestion.projectId } };
    }
    if (action === 'todo') {
      const { suggestion, projectId } = desk.toTodo(id, device, at);
      return { status: 200, body: { suggestion: suggestionView(suggestion), lineId: null, projectId } };
    }
    const suggestion = desk.dismiss(id, device, at);
    return { status: 200, body: { suggestion: suggestionView(suggestion), lineId: null, projectId: null } };
  }));
}

export function startSuggestion(context: RequestContext): Promise<Reply> {
  return suggestionAction(context, 'start');
}

export function todoSuggestion(context: RequestContext): Promise<Reply> {
  return suggestionAction(context, 'todo');
}

export function dismissSuggestion(context: RequestContext): Promise<Reply> {
  return suggestionAction(context, 'dismiss');
}

/** POST /v2/tasks/time-zone：这台设备现在在哪个时区（打开时、换了时区时报）；回定时现在按哪个时区算。 */
export async function reportTimeZone(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const input = checkInput(DeviceTimeZoneRequestSchema, await readJsonBody(context.req), '时区');
  if (!isTimeZone(input.timeZone)) {
    throw new ApiError(400, 'invalid_request', '不认识这个时区。', { field: 'timeZone' });
  }
  context.deps.state.deviceTimeZones.report(auth.device.id, input.timeZone);
  const schedules = context.deps.tasks.schedules;
  // 时区变了，还没到点的马上按新时区重排，不等下一分钟。
  schedules.tick();
  return { status: 200, body: { timeZone: schedules.timeZone() } };
}
