// /v2/tasks… 的真实现（形状见 agent/shared/api/tasks-board.ts）。写操作都带 requestId：没拿到回答算「结果待核实」。

import type { TasksApi } from '../tasks-client.ts';
import {
  DEVICE_TIME_ZONE_PATH,
  HEARTBEAT_PATH,
  HEARTBEAT_SAY_PATH,
  HeartbeatViewSchema,
  type HeartbeatSayRequest,
  type UpdateHeartbeatRequest,
  DeviceTimeZoneResponseSchema,
  SUGGESTIONS_PATH,
  SuggestionActionResponseSchema,
  TASKS_BOARD_PATH,
  TEAMMATE_STOP_PATH,
  TIMED_ENABLE_PATH,
  TIMED_REMOVE_PATH,
  TasksBoardResponseSchema,
  TeammateResponseSchema,
  TimedRowResponseSchema,
  type DeviceTimeZoneRequest,
  type SuggestionAction,
  type SuggestionActionRequest,
  type TasksBoardQuery,
  type TeammateStopRequest,
  type TimedEnableRequest,
  type TimedRemoveRequest,
} from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpTasks implements TasksApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  board(query: TasksBoardQuery, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: TASKS_BOARD_PATH, query: { ...query },
      schema: TasksBoardResponseSchema, what: '读任务', lostAs: 'failed', signal });
  }

  setTimedEnabled(body: TimedEnableRequest) {
    return this.transport.request({ method: 'POST', path: TIMED_ENABLE_PATH, body, schema: TimedRowResponseSchema,
      what: body.on ? '打开定时任务' : '停下定时任务', lostAs: 'uncertain' });
  }

  removeTimed(body: TimedRemoveRequest) {
    return this.transport.request({ method: 'POST', path: TIMED_REMOVE_PATH, body, schema: TimedRowResponseSchema,
      what: '删定时任务', lostAs: 'uncertain' });
  }

  stopTeammate(body: TeammateStopRequest) {
    return this.transport.request({ method: 'POST', path: TEAMMATE_STOP_PATH, body, schema: TeammateResponseSchema,
      what: '叫停', lostAs: 'uncertain' });
  }

  suggestion(id: string, action: SuggestionAction, body: SuggestionActionRequest) {
    const what = action === 'start' ? '开始做' : action === 'todo' ? '加成待办' : '忽略建议';
    return this.transport.request({ method: 'POST', path: `${SUGGESTIONS_PATH}/${encodeURIComponent(id)}/${action}`,
      body, schema: SuggestionActionResponseSchema, what, lostAs: 'uncertain' });
  }

  reportTimeZone(body: DeviceTimeZoneRequest) {
    return this.transport.request({ method: 'POST', path: DEVICE_TIME_ZONE_PATH, body,
      schema: DeviceTimeZoneResponseSchema, what: '报时区', lostAs: 'failed' });
  }

  heartbeat(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: HEARTBEAT_PATH, schema: HeartbeatViewSchema,
      what: '读心跳', lostAs: 'failed', signal });
  }

  updateHeartbeat(body: UpdateHeartbeatRequest) {
    return this.transport.request({ method: 'PUT', path: HEARTBEAT_PATH, body, schema: HeartbeatViewSchema,
      what: '改心跳', lostAs: 'uncertain' });
  }

  sayToHeartbeat(body: HeartbeatSayRequest) {
    return this.transport.request({ method: 'POST', path: HEARTBEAT_SAY_PATH, body, schema: HeartbeatViewSchema,
      what: '改心跳的清单', lostAs: 'uncertain' });
  }
}
