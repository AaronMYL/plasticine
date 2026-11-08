// 记账、日历按用户时区分天：一个月、一周（周一起）、一年各是哪几天，一个时刻落在哪一天。读库时按 UTC 时间放宽一天
// 取，再按本地日期筛，所以时区边上的那一笔不会漏。

import { localDay } from '../daily/index.ts';
import { LifeError } from './errors.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const STAT_RANGES = ['week', 'month', 'year'] as const;
export type StatRange = (typeof STAT_RANGES)[number];

/** A span of local days, `from` inclusive, `to` exclusive (both `YYYY-MM-DD`). */
export interface DaySpan {
  from: string;
  to: string;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(day: string): Date {
  const match = DAY_PATTERN.exec(day);
  if (match === null) {
    throw new LifeError('invalid_input', '日期写成 YYYY-MM-DD。', 'anchor');
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (isoDay(date) !== day) {
    throw new LifeError('invalid_input', `没有 ${day} 这一天。`, 'anchor');
  }
  return date;
}

export function monthSpan(month: string): DaySpan {
  const match = MONTH_PATTERN.exec(month);
  const index = match === null ? Number.NaN : Number(match[2]);
  if (match === null || index < 1 || index > 12) {
    throw new LifeError('invalid_input', '月份写成 YYYY-MM。', 'month');
  }
  const year = Number(match[1]);
  return { from: `${month}-01`, to: isoDay(new Date(Date.UTC(year, index, 1))) };
}

export function rangeSpan(range: StatRange, anchor: string): DaySpan {
  const day = utcDate(anchor);
  if (range === 'year') {
    const year = day.getUTCFullYear();
    return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }
  if (range === 'month') {
    return monthSpan(anchor.slice(0, 7));
  }
  // 周一起（1ca0391 money.ts）。
  const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
  return { from: isoDay(monday), to: isoDay(new Date(monday.getTime() + 7 * DAY_MS)) };
}

/** UTC instants that surely cover the local days of `span` in any time zone (±14 h, so a day on each side). */
export function widenedInstants(span: DaySpan): { from: string; to: string } {
  const from = new Date(utcDate(span.from).getTime() - DAY_MS).toISOString();
  const to = new Date(utcDate(span.to).getTime() + DAY_MS).toISOString();
  return { from, to };
}

export function dayOf(instant: string, timeZone: string): string {
  return localDay(new Date(instant), timeZone);
}

export function inSpan(day: string, span: DaySpan): boolean {
  return day >= span.from && day < span.to;
}

/** Every day of the span in order. */
export function daysOf(span: DaySpan): string[] {
  const days: string[] = [];
  for (let at = utcDate(span.from).getTime(); isoDay(new Date(at)) < span.to; at += DAY_MS) {
    days.push(isoDay(new Date(at)));
  }
  return days;
}
