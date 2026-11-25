import { CALENDAR_STALE_MS } from '../../shared/api/index.ts';
import type { CalendarEvent } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { eventKey } from './today.ts';

function clock(iso: string, zone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' });
}

function span(event: CalendarEvent, zone: string): string {
  return `${clock(event.start, zone)}–${clock(event.end, zone)}「${event.title}」`;
}

export function calendarConflicts(events: readonly CalendarEvent[], from: Date, to: Date,
  zone: string): { id: string; text: string }[] {
  const timed = events
    .filter((event) => !event.allDay && Date.parse(event.end) > Date.parse(event.start))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  const inWindow = (event: CalendarEvent): boolean => Date.parse(event.start) < to.getTime()
    && Date.parse(event.end) > from.getTime();
  const found: { id: string; text: string }[] = [];
  for (const [index, first] of timed.entries()) {
    for (const second of timed.slice(index + 1)) {
      if (Date.parse(second.start) >= Date.parse(first.end)) {
        break;
      }
      if (!inWindow(first) && !inWindow(second)) {
        continue;
      }
      found.push({ id: `${eventKey(first)}|${eventKey(second)}`,
        text: `日程撞了：${span(first, zone)}和 ${span(second, zone)}` });
    }
  }
  return found;
}

export function cachedConflicts(state: Pick<StateService, 'calendarSnapshots'>, zone: () => string,
  now: () => Date): { conflicts(from: Date, to: Date): { id: string; text: string }[] } {
  return {
    conflicts(from, to) {
      const snapshot = state.calendarSnapshots.latestEvents();
      if (snapshot === undefined) {
        return [];
      }
      const found = calendarConflicts(snapshot.items, from, to, zone());
      if (now().getTime() - Date.parse(snapshot.syncedAt) <= CALENDAR_STALE_MS) {
        return found;
      }
      const note = `（日历 ${clock(snapshot.syncedAt, zone())} 同步的，Mac 现在不在线）`;
      return found.map((item) => ({ id: item.id, text: item.text + note }));
    },
  };
}
