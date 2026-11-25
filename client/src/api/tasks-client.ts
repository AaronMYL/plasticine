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
  TimerStopRequest,
  TimerStopResponse,
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
  stopTimer(body: TimerStopRequest): Promise<TimerStopResponse>;
  /** POST /v2/tasks/suggestions/:id/(start|todo|dismiss) */
  suggestion(id: string, action: SuggestionAction, body: SuggestionActionRequest): Promise<SuggestionActionResponse>;
  /** POST /v2/tasks/time-zone */
  reportTimeZone(body: DeviceTimeZoneRequest): Promise<DeviceTimeZoneResponse>;
  heartbeat(signal?: AbortSignal): Promise<HeartbeatView>;
  updateHeartbeat(body: UpdateHeartbeatRequest): Promise<HeartbeatView>;
  sayToHeartbeat(body: HeartbeatSayRequest): Promise<HeartbeatView>;
}
