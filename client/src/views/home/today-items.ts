import { CALENDAR_STALE_MS, type TodayEvent } from '../../api/shared.ts';
import type { HueName } from '../../shell/hue.tsx';

const MINUTE_MS = 60_000;
const SOON_MS = 2 * 60 * MINUTE_MS;

function hueOf(hex: string): { hue: number; saturation: number } | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) {
    return null;
  }
  const [red, green, blue] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? '0', 16) / 255) as
    [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  if (delta === 0) {
    return { hue: 0, saturation };
  }
  let hue: number;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return { hue: (hue * 60 + 360) % 360, saturation };
}

const HUE_BANDS: readonly [number, HueName][] = [
  [15, 'rose'], [40, 'clay'], [65, 'ochre'], [90, 'olive'], [160, 'sage'], [190, 'teal'], [250, 'sky'],
  [330, 'slate'], [360, 'rose'],
];

export function calendarHue(hex: string | null): HueName {
  const parsed = hex === null ? null : hueOf(hex);
  if (parsed === null || parsed.saturation < 0.15) {
    return 'ink';
  }
  return HUE_BANDS.find(([limit]) => parsed.hue < limit)?.[1] ?? 'rose';
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
    .format(new Date(iso));
}

export function eventTime(event: TodayEvent, timeZone: string, phone: boolean): string {
  if (event.allDay) {
    return '全天';
  }
  const start = clock(event.start, timeZone);
  return phone ? start : `${start}–${clock(event.end, timeZone)}`;
}

function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

export function eventMeta(event: TodayEvent, now: Date): string | null {
  if (event.allDay) {
    return null;
  }
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const at = now.getTime();
  if (start <= at && at < end) {
    return `还有 ${span(end - at)}`;
  }
  if (at < start && start - at <= SOON_MS) {
    return `${span(start - at)}后`;
  }
  return null;
}

export function staleNote(syncedAt: string | null, now: Date, timeZone: string): string | null {
  if (syncedAt === null || now.getTime() - Date.parse(syncedAt) <= CALENDAR_STALE_MS) {
    return null;
  }
  const day = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  const date = day(syncedAt) === day(now.toISOString()) ? ''
    : `${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone }).format(new Date(syncedAt))} `;
  return `${date}${clock(syncedAt, timeZone)} 同步`;
}

export function reminderTime(due: string, hasTime: boolean, timeZone: string): string {
  return hasTime ? clock(due, timeZone) : '';
}
