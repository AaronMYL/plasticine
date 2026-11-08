// 任务栏目的接口（《优化清单》第 3、4、5 条；形状在 agent/shared/api/tasks-board.ts）：第二栏和主区读一份；定时的开关、
// 删除；叫停队友；建议的开始做 / 加成待办 / 忽略；设备报自己现在的时区；心跳的弹层（第 11 条）。http/ 的真实现和 fake/ 的内存实现都满足这里。

import type {
  HeartbeatSayRequest,
  HeartbeatView,
  UpdateHeartbeatRequest,
  DeviceTimeZoneRequest,
  DeviceTimeZoneResponse,
  SuggestionAction,
  SuggestionActionRequest,
  SuggestionActionResponse,
  TasksBoardQuery,
  TasksBoardResponse,
  TeammateResponse,
  TeammateStopRequest,
  TimedEnableRequest,
  TimedRemoveRequest,
  TimedRowResponse,
} from './shared.ts';

export interface TasksApi {
  /** GET /v2/tasks/board?projectId= */
  board(query: TasksBoardQuery, signal?: AbortSignal): Promise<TasksBoardResponse>;
  /** POST /v2/tasks/timed/enable */
  setTimedEnabled(body: TimedEnableRequest): Promise<TimedRowResponse>;
  /** POST /v2/tasks/timed/remove */
  removeTimed(body: TimedRemoveRequest): Promise<TimedRowResponse>;
  /** POST /v2/tasks/teammates/stop */
  stopTeammate(body: TeammateStopRequest): Promise<TeammateResponse>;
  /** POST /v2/tasks/suggestions/:id/(start|todo|dismiss) */
  suggestion(id: string, action: SuggestionAction, body: SuggestionActionRequest): Promise<SuggestionActionResponse>;
  /** POST /v2/tasks/time-zone */
  reportTimeZone(body: DeviceTimeZoneRequest): Promise<DeviceTimeZoneResponse>;
  /** GET /v2/heartbeat：心跳的弹层（第 11 条）。 */
  heartbeat(signal?: AbortSignal): Promise<HeartbeatView>;
  /** PUT /v2/heartbeat：多久一次、清单（整份）。 */
  updateHeartbeat(body: UpdateHeartbeatRequest): Promise<HeartbeatView>;
  /** POST /v2/heartbeat/say：一句话改清单。 */
  sayToHeartbeat(body: HeartbeatSayRequest): Promise<HeartbeatView>;
}
