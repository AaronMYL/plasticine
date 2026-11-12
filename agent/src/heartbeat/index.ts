// heartbeat/：心跳（《优化清单》第 11 条，11-06 定）。每 30 分钟看一眼一张很短的清单（23:00–08:00 不跳）；先用代码
// 比对有没有新变化，没有就不叫模型；有变化叫便宜模型（用途 heartbeat）判断：有事在主线上发一条消息，硬线以下的开
// 后台线去做，拿不准的进建议。外面只经这里：assemble 装好、登记进 tasks 的「定时」，app/ 挂 /v2/heartbeat。

export { applyEdit, ChecklistError, DEFAULT_CONFIG, DEFAULT_ITEMS, readConfig, replaceItems } from './checklist.ts';
export { CALENDAR_AHEAD_MS, collectFacts, FOLLOW_UP_PREFIX, freshFacts, STUCK_ITEM, WAITING_TOO_LONG_MS }
  from './facts.ts';
export type { CalendarPort, StalledPort, StuckPort } from './facts.ts';
export { Heartbeat, HEARTBEAT_SLOT_ID, inQuiet } from './heartbeat.ts';
export type { HeartbeatOptions, HeartbeatState } from './heartbeat.ts';
export { heartbeatChecklistTool } from './tool.ts';
