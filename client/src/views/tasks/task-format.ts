import type { SuggestionView, TimedRowView } from '../../api/shared.ts';
import type { IconName } from '../../shell/icons.tsx';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function parts(iso: string, timeZone: string) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(iso));
  const get = (type: string): string => values.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, month: get('month'), date: get('day'),
    clock: `${get('hour')}:${get('minute')}`, weekday: get('weekday') };
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function nextText(iso: string, now: Date, timeZone: string): string {
  const at = parts(iso, timeZone);
  const today = parts(now.toISOString(), timeZone).day;
  const tomorrow = parts(new Date(now.getTime() + DAY_MS).toISOString(), timeZone).day;
  if (at.day === today) {
    return at.clock;
  }
  if (at.day === tomorrow) {
    return `明天 ${at.clock}`;
  }
  if (Date.parse(iso) - now.getTime() < 6 * DAY_MS) {
    return `周${WEEKDAYS[WEEKDAY_INDEX[at.weekday] ?? 0]} ${at.clock}`;
  }
  return `${at.month}/${at.date} ${at.clock}`;
}

export function runningFor(since: string | null, now: number): string | null {
  if (since === null) {
    return null;
  }
  const minutes = Math.max(1, Math.floor((now - Date.parse(since)) / MINUTE_MS));
  return minutes < 60 ? `${minutes} 分` : `${Math.floor(minutes / 60)} 小时`;
}

export function timedIcon(icon: TimedRowView['icon']): IconName {
  return icon === 'space' ? 'chart' : icon;
}

export function ideaIcon(icon: SuggestionView['icon']): IconName {
  return icon === 'space' ? 'chart' : icon;
}

export function ideaHue(icon: SuggestionView['icon']): 'ochre' | 'sky' {
  return icon === 'books' ? 'ochre' : 'sky';
}
