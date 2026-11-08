// 图书页上的几种写法：百分比、「昨天 22:14」、章名的短写（「卷一　闺房记乐」→「卷一」）、全书位置。

import type { BookTocEntry, BookView } from '../../api/shared.ts';
import { timeInput } from '../../primitives/message/states.ts';
import { deviceTimeZone } from '../../state/time-zone.ts';

const DAY_MS = 86_400_000;
// 「读完」的线：最后一屏常常停在 99% 多一点，算读完。
const FINISHED_AT = 0.995;
// 中文阅读速度按每分钟 400 字估（「本章约 9 分钟」）；只给个量级，不精确。
const CHARS_PER_MINUTE = 400;

export function percentText(percent: number): string {
  return `${Math.round(percent * 100)}%`;
}

/** 图书馆格子下面那一个字：未读 / 读完 / 18%。 */
export function progressLabel(book: Pick<BookView, 'progress'>): string {
  const percent = book.progress?.percent ?? 0;
  if (book.progress === null || percent <= 0) {
    return '未读';
  }
  return percent >= FINISHED_AT ? '读完' : percentText(percent);
}

export function isReading(book: Pick<BookView, 'progress'>): boolean {
  const percent = book.progress?.percent ?? 0;
  return book.progress !== null && percent > 0 && percent < FINISHED_AT;
}

/** 今天写「今天 08:12」，昨天「昨天 22:14」，今年「10-31 23:02」（dateOnly 时「10-29」），更早带年份。 */
export function readingTime(iso: string, now: Date, options: { dateOnly?: boolean } = {},
  timeZone = deviceTimeZone()): string {
  const local = timeInput(iso, timeZone);
  const day = local.slice(0, 10);
  const clock = local.slice(11, 16);
  const today = timeInput(now.toISOString(), timeZone).slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  if (day === today) {
    return `今天 ${clock}`;
  }
  if (day === yesterday) {
    return `昨天 ${clock}`;
  }
  const date = day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day;
  return options.dateOnly === true ? date : `${date} ${clock}`;
}

/** 章名第一段：「卷一　闺房记乐」→「卷一」；没有空格就是整个章名。 */
export function chapterShort(title: string): string {
  return title.trim().split(/[\s　]+/)[0] ?? title;
}

/** 「卷一　闺房记乐」→「卷一 · 闺房记乐」（图书馆「在读」那一行）。 */
export function chapterDotted(title: string): string {
  return title.trim().split(/[\s　]+/).join(' · ');
}

/** 书里一处位置在全书的比例：前面几章的字数加章内下标，除以全书字数。 */
export function bookPercent(toc: readonly BookTocEntry[], chapter: number, offset: number): number {
  const total = toc.reduce((sum, entry) => sum + entry.chars, 0);
  if (total === 0) {
    return 0;
  }
  const before = toc.slice(0, chapter).reduce((sum, entry) => sum + entry.chars, 0);
  return Math.min(1, Math.max(0, (before + offset) / total));
}

export function minutesToRead(chars: number): number {
  return Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
}

/** 书名是不是适合竖排：全是中日文字（含间隔号），不超过 8 个字。 */
export function verticalTitle(title: string): boolean {
  return /^[㐀-鿿　-〿·・]{1,8}$/.test(title);
}
