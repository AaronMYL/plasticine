// 「今天」按用户的时区算（时间一律 ISO 存、按用户时区显示）。An unknown time zone throws RangeError (Intl), which app/
// answers as a 400 naming `tz`. A day starts at its first existing instant: a skipped midnight starts later, and a
// repeated midnight starts at the first occurrence (M4 审查 P2).

import { DailyError } from './errors.ts';

// 用户在国内，旧版也按北京时间（shared/api/tasks.ts DEFAULT_TIME_ZONE）；后台扫描没有请求带来的时区时用它。
export const BACKGROUND_TIME_ZONE = 'Asia/Shanghai';
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Two days on either side cover IANA offsets and a whole calendar day skipped at the date line.
const SEARCH_RADIUS_MS = 2 * 24 * 60 * 60 * 1000;

function dayFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** The local calendar day of an instant, `YYYY-MM-DD`. */
export function localDay(instant: Date, timeZone: string): string {
  return dayFormat(timeZone).format(instant);
}

/** UTC is only a search anchor; it does not assume the local midnight exists or is unique. */
function calendarAnchor(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (match === null) {
    throw new DailyError('invalid_input', '日期格式不对，请填写存在的 YYYY-MM-DD 日期。', 'day');
  }
  const midnightAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(midnightAsUtc).toISOString().slice(0, 10) !== day) {
    throw new DailyError('invalid_input', '这个日期不存在，请检查 day 的年月日。', 'day');
  }
  return midnightAsUtc;
}

function firstInstantOnOrAfter(day: string, timeZone: string): Date {
  const anchor = calendarAnchor(day);
  const format = dayFormat(timeZone);
  let before = anchor - SEARCH_RADIUS_MS;
  let after = anchor + SEARCH_RADIUS_MS;
  // Compare calendar dates instead of solving wall-clock offsets, which oscillate when midnight is skipped.
  while (after - before > 1) {
    const middle = before + Math.floor((after - before) / 2);
    if (format.format(new Date(middle)) < day) {
      before = middle;
    } else {
      after = middle;
    }
  }
  return new Date(after);
}

/** The first existing instant of a local calendar day (`YYYY-MM-DD`). */
export function dayStartOf(day: string, timeZone: string): Date {
  const start = firstInstantOnOrAfter(day, timeZone);
  if (localDay(start, timeZone) !== day) {
    throw new DailyError('invalid_input', '这个日期在所选时区被整天跳过，请换一个日期。', 'day');
  }
  return start;
}

function nextDay(day: string): string {
  const match = DAY_PATTERN.exec(day);
  const next = new Date(Date.UTC(Number(match?.[1]), Number(match?.[2]) - 1, Number(match?.[3]) + 1));
  return next.toISOString().slice(0, 10);
}

/** The instant the local day of `instant` began. */
export function localDayStart(instant: Date, timeZone: string): Date {
  return dayStartOf(localDay(instant, timeZone), timeZone);
}

/** [start, end) of a local day as instants: what 「这一天的条目」 means for a stored arrival time. */
export function dayRange(day: string, timeZone: string): { start: Date; end: Date } {
  return { start: dayStartOf(day, timeZone), end: firstInstantOnOrAfter(nextDay(day), timeZone) };
}
