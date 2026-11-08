// 心跳的「接下来两小时的日历冲突」（第 11、15 条）：缓存里有一段落在这两小时里、又和另一段时间重叠的两个日程，
// 一对算一件（key 是两个日程的身份，下一跳还在就不算新变化）。全天的日程不算冲突。

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

/** 心跳的 CalendarPort：读缓存；缓存超过 1 小时没同步，每件后面注明几点同步的（他据此知道可能不准）。 */
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
