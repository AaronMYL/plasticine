// 定时的钟点（《优化清单》第 3 条）：每天几点、每周哪几天几点、每隔多少分钟。钟点按他设备当前的时区解释（11-07 定：
// 出差换地方，到点时间跟着变）；错过的（设备关机、服务重启）「下次到点照常，补跑最近一次」，不一口气补几十次。

import type { ScheduleCadence } from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** 往后找下一次最多看这么多天：每周的也一定落在 8 天之内。 */
const LOOKAHEAD_DAYS = 8;
/** 补跑时往后数最多这么多次（每 15 分钟一次的，补一个月也够），再多就直接取「现在之前最近的一次」。 */
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

/** 某个时区里某一天的某个钟点是哪一刻（夏令时那天照本地钟点算；被跳过的钟点落在跳过之后）。 */
export function zonedClock(day: string, clock: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T${clock}:00Z`);
  const first = guess - offsetMs(timeZone, guess);
  const second = guess - offsetMs(timeZone, first);
  return new Date(second);
}

/** 1 = 周一 … 7 = 周日。 */
function weekdayOf(day: string): number {
  const sunday0 = new Date(`${day}T12:00:00Z`).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** after 之后（不含）的第一次。 */
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

/**
 * 到点了（nextAt ≤ now）：这次补跑的是哪一刻——nextAt 之后、不晚于 now 的最近一次。关机三天只补最后那一次。
 */
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

/** 卡上和列表里那一句：「每天 15:00」「周一 09:00」「工作日 09:00」「每 30 分钟」。 */
export function cadenceLabel(cadence: ScheduleCadence): string {
  if (cadence.type === 'daily') {
    return `每天 ${cadence.at}`;
  }
  if (cadence.type === 'weekly') {
    return `${daysLabel(cadence.days)} ${cadence.at}`;
  }
  return cadence.minutes % 60 === 0 ? `每 ${cadence.minutes / 60} 小时` : `每 ${cadence.minutes} 分钟`;
}
