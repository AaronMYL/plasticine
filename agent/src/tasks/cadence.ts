import type { ScheduleCadence } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const LOOKAHEAD_DAYS = 8;
const CATCH_UP_STEPS = 3_000;
const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
const WORKDAYS = [1, 2, 3, 4, 5];

function offsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'),
    value('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function zonedClock(day: string, clock: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T${clock}:00Z`);
  const first = guess - offsetMs(timeZone, guess);
  const second = guess - offsetMs(timeZone, first);
  return new Date(second);
}

function weekdayOf(day: string): number {
  const sunday0 = new Date(`${day}T12:00:00Z`).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function nextRun(cadence: ScheduleCadence, after: Date, timeZone: string): Date {
  if (cadence.type === 'interval') {
    return new Date(after.getTime() + cadence.minutes * MINUTE_MS);
  }
  const days = cadence.type === 'daily' ? null : cadence.days;
  const start = localDay(after, timeZone);
  for (let offset = 0; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const day = addDays(start, offset);
    if (days !== null && !days.includes(weekdayOf(day))) {
      continue;
    }
    const at = zonedClock(day, cadence.at, timeZone);
    if (at.getTime() > after.getTime()) {
      return at;
    }
  }
  throw new Error(`定时的钟点算不出下一次（${JSON.stringify(cadence)}，${timeZone}）`);
}

export function latestDue(cadence: ScheduleCadence, nextAt: Date, now: Date, timeZone: string): Date {
  if (cadence.type === 'interval') {
    const missed = Math.floor((now.getTime() - nextAt.getTime()) / (cadence.minutes * MINUTE_MS));
    return new Date(nextAt.getTime() + Math.max(0, missed) * cadence.minutes * MINUTE_MS);
  }
  let due = nextAt;
  for (let step = 0; step < CATCH_UP_STEPS; step += 1) {
    const following = nextRun(cadence, due, timeZone);
    if (following.getTime() > now.getTime()) {
      return due;
    }
    due = following;
  }
  return due;
}

const COVER_MS = 20 * 60 * MINUTE_MS;

export function nextAfterRun(cadence: ScheduleCadence, due: Date, now: Date, timeZone: string): Date {
  let next = nextRun(cadence, now, timeZone);
  if (cadence.type !== 'interval' && localDay(next, timeZone) === localDay(due, timeZone)) {
    next = nextRun(cadence, next, timeZone);
  }
  return next;
}

export function rezonedNext(cadence: ScheduleCadence, previous: Date | null, now: Date, timeZone: string,
  lastRunAt: Date | null): Date {
  const candidate = lastRunAt === null ? nextRun(cadence, now, timeZone)
    : nextAfterRun(cadence, lastRunAt, now, timeZone);
  if (previous !== null && previous.getTime() > now.getTime() && previous.getTime() < candidate.getTime()
    && localDay(previous, timeZone) !== localDay(candidate, timeZone)) {
    return previous;
  }
  return candidate;
}

export function missedDue(cadence: ScheduleCadence, now: Date, timeZone: string, graceMs: number): Date | null {
  if (cadence.type === 'interval') {
    return null;
  }
  const limit = now.getTime() - graceMs;
  let due: Date | null = null;
  let at = nextRun(cadence, new Date(now.getTime() - DAY_MS - graceMs), timeZone);
  while (at.getTime() <= limit) {
    due = at;
    at = nextRun(cadence, at, timeZone);
  }
  return due;
}

export function coveredBy(lastRunAt: Date | null, due: Date): boolean {
  return lastRunAt !== null && lastRunAt.getTime() > due.getTime() - COVER_MS;
}

function daysLabel(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) {
    return '每天';
  }
  if (sorted.join() === WORKDAYS.join()) {
    return '工作日';
  }
  if (sorted.join() === '6,7') {
    return '周末';
  }
  return `周${sorted.map((day) => WEEKDAY_NAMES[day - 1]).join('、')}`;
}

export function cadenceLabel(cadence: ScheduleCadence): string {
  if (cadence.type === 'daily') {
    return `每天 ${cadence.at}`;
  }
  if (cadence.type === 'weekly') {
    return `${daysLabel(cadence.days)} ${cadence.at}`;
  }
  return cadence.minutes % 60 === 0 ? `每 ${cadence.minutes / 60} 小时` : `每 ${cadence.minutes} 分钟`;
}
