// /v2/calendar/today（shared/api/calendar.ts，《优化清单》第 15 条）：首页「现在」的「今天」一节。读日历缓存，
// 按 Mac 报的能力决定出不出日程、提醒那两块；顺便叫一次同步（Mac 在线才拉，一分钟最多一次），拉完推 calendar_changed。

import { CALENDAR_TODAY_PATH, CalendarTodayQuerySchema, DEFAULT_TIME_ZONE } from '../../shared/api/index.ts';
import { calendarToday } from '../calendar/index.ts';
import { nodeOnline } from '../devices/index.ts';
import { requireUserAuth, type Reply, type RequestContext, type Route } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

/** GET /v2/calendar/today?tz= */
export function readCalendarToday(context: RequestContext): Reply {
  requireUserAuth(context);
  const query = checkInput(CalendarTodayQuerySchema, queryObject(context.url.searchParams, {}), '查询参数');
  const { deps } = context;
  const zone = query.tz ?? deps.state.dailySettings.read().settings.timeZone ?? DEFAULT_TIME_ZONE;
  const now = deps.now();
  const mac = deps.calendar.mac();
  deps.calendar.kick();
  return { status: 200, body: calendarToday({ now, zone,
    macOnline: mac !== null && nodeOnline(mac, now),
    calendar: mac?.capabilities.includes('calendar_list') ?? false,
    reminders: mac?.capabilities.includes('reminder_list') ?? false,
    events: deps.state.calendarSnapshots.latestEvents(),
    reminderSnapshot: deps.state.calendarSnapshots.latestReminders() }) };
}

export const CALENDAR_ROUTES: readonly Route[] = [
  { method: 'GET', path: CALENDAR_TODAY_PATH, auth: true, handler: readCalendarToday },
];
