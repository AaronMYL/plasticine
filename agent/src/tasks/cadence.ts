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

/** 查漏发时，上次出的比本该出的早不到这么久，算这一期出过了（换了时区，同一期早几个小时出了）。 */
const COVER_MS = 20 * 60 * MINUTE_MS;

/**
 * 出完一期以后排下一次：按现在的时区，和这一期落在同一天的跳过，免得换了时区同一天再出一期。interval 照常往后排。
 */
export function nextAfterRun(cadence: ScheduleCadence, due: Date, now: Date, timeZone: string): Date {
  let next = nextRun(cadence, now, timeZone);
  if (cadence.type !== 'interval' && localDay(next, timeZone) === localDay(due, timeZone)) {
    next = nextRun(cadence, next, timeZone);
  }
  return next;
}

/**
 * 时区或钟点变了，还没到的那一次怎么重排（11-12：两台设备报的时区来回切，每切一次从现在重排，跨过 08:00
 * 的那一期就没了）：按新时区算下一次；新算的落到旧的那次之后的另一天，就留着旧的先出，保证不漏；
 * 新算的和上次出的在新时区里是同一天，往后挪一期，同一天不重复出。
 */
export function rezonedNext(cadence: ScheduleCadence, previous: Date | null, now: Date, timeZone: string,
  lastRunAt: Date | null): Date {
  const candidate = lastRunAt === null ? nextRun(cadence, now, timeZone)
    : nextAfterRun(cadence, lastRunAt, now, timeZone);
  // 出差：新时区里同一天，挪到当地的同一个钟点；新算的跨到了后一天（中间那一期会没了），留着旧的先出。
  if (previous !== null && previous.getTime() > now.getTime() && previous.getTime() < candidate.getTime()
    && localDay(previous, timeZone) !== localDay(candidate, timeZone)) {
    return previous;
  }
  return candidate;
}

/**
 * 最近一次本该出、而且已经过了 grace 的那一刻（往回看一天）；没有就 null。心跳拿它查漏发。
 */
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

/** 这一期算出过没有：上次出的不早于本该出的那一刻 20 小时以前（换时区挪了几个小时也算）。 */
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
