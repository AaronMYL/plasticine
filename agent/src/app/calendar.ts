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
