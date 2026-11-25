import { timeInput } from '../primitives/message/states.ts';
import { deviceTimeZone } from '../state/time-zone.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function dayOf(iso: string, timeZone: string): string {
  return timeInput(iso, timeZone).slice(0, 10);
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / DAY_MS;
}

export function timeText(iso: string, now: Date, timeZone: string = deviceTimeZone()): string {
  const ago = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ago)) return '';
  if (ago >= 0 && ago < MINUTE_MS) return '刚刚';
  if (ago >= 0 && ago < HOUR_MS) return `${Math.floor(ago / MINUTE_MS)} 分钟前`;
  const local = timeInput(iso, timeZone);
  const day = local.slice(0, 10);
  const today = dayOf(now.toISOString(), timeZone);
  const gap = dayNumber(today) - dayNumber(day);
  if (gap === 0) return local.slice(11, 16);
  if (gap === 1) return '昨天';
  if (gap > 1 && gap < WEEK_DAYS) return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? day.slice(5);
  return day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day;
}

export function bodyDate(iso: string, now: Date = new Date(), timeZone: string = deviceTimeZone()): string {
  const day = dayOf(iso, timeZone);
  if (day === '') return '';
  const [year, month, date] = day.split('-').map(Number);
  const md = `${month} 月 ${date} 日`;
  return day.slice(0, 4) === dayOf(now.toISOString(), timeZone).slice(0, 4) ? md : `${year} 年 ${md}`;
}
