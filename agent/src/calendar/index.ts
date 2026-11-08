// calendar/：他 Mac 上的 Apple 日历和提醒事项（《优化清单》第 15 条，11-06 定）。Mac 在线时经设备通道（Mac 助手进程）
// 定期同步今天和接下来 7 天进缓存；首页「今天」、心跳的冲突检查读缓存；给模型的查日程、建日程、建提醒、完成提醒工具。
// 自己不调模型，不写库以外的地方（缓存经 state/ 的 calendarSnapshots）。

export { cachedConflicts, calendarConflicts } from './conflicts.ts';
export {
  CALENDAR_KICK_GAP_MS, CALENDAR_SYNC_DAYS, CALENDAR_SYNC_EVERY_MS, CalendarSync, calendarMac, syncWindow,
} from './sync.ts';
export type { CalendarDevicePort, CalendarSyncOptions, CalendarSyncState } from './sync.ts';
export { calendarToday, eventKey } from './today.ts';
export type { TodayInput } from './today.ts';
export { calendarTools } from './tools.ts';
export type { CalendarToolParts } from './tools.ts';
