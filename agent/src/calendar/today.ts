import type { CalendarTodayView, TodayEvent, TodayReminder } from '../../shared/api/index.ts';
import type { CalendarEvent, CalendarEventsSnapshot, CalendarRemindersSnapshot } from '../../shared/state.ts';
import { dayRange, localDay } from '../daily/index.ts';

export interface TodayInput {
  now: Date;
  zone: string;
  macOnline: boolean;
  calendar: boolean;
  reminders: boolean;
  events?: CalendarEventsSnapshot | undefined;
  reminderSnapshot?: CalendarRemindersSnapshot | undefined;
}

export function eventKey(event: CalendarEvent): string {
  return `${event.id}@${event.start}`;
}

function todayEvents(snapshot: CalendarEventsSnapshot, start: Date, end: Date, now: Date): TodayEvent[] {
  return snapshot.items
    .filter((item) => Date.parse(item.start) < end.getTime() && Date.parse(item.end) > now.getTime()
      && Date.parse(item.end) > start.getTime())
    .sort((left, right) => Number(right.allDay) - Number(left.allDay)
      || Date.parse(left.start) - Date.parse(right.start) || left.title.localeCompare(right.title))
    .map((item) => ({ kind: 'event', key: eventKey(item), title: item.title, start: item.start, end: item.end,
      allDay: item.allDay, color: item.color ?? null, calendar: item.calendar }));
}

function todayReminders(snapshot: CalendarRemindersSnapshot, end: Date): TodayReminder[] {
  const due: TodayReminder[] = [];
  for (const item of snapshot.items) {
    if (item.completed || item.due === null || Date.parse(item.due) >= end.getTime()) {
      continue;
    }
    due.push({ kind: 'reminder', key: item.id, title: item.title, due: item.due, hasTime: item.dueHasTime === true,
      list: item.list });
  }
  return due.sort((left, right) => Date.parse(left.due) - Date.parse(right.due)
    || left.title.localeCompare(right.title));
}

export function calendarToday(input: TodayInput): CalendarTodayView {
  const { start, end } = dayRange(localDay(input.now, input.zone), input.zone);
  const events = input.calendar && input.events !== undefined ? input.events : undefined;
  const reminders = input.reminders && input.reminderSnapshot !== undefined ? input.reminderSnapshot : undefined;
  const synced = [events?.syncedAt, reminders?.syncedAt].filter((at): at is string => at !== undefined).sort();
  return {
    calendar: input.calendar,
    reminders: input.reminders,
    events: events === undefined ? [] : todayEvents(events, start, end, input.now),
    reminderItems: reminders === undefined ? [] : todayReminders(reminders, end),
    syncedAt: synced[0] ?? null,
    macOnline: input.macOnline,
  };
}
