import type { BookTocEntry, BookView } from '../../api/shared.ts';

const FINISHED_AT = 0.995;
const CHARS_PER_MINUTE = 400;

export function percentText(percent: number): string {
  return `${Math.round(percent * 100)}%`;
}

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

export function chapterShort(title: string): string {
  return title.trim().split(/[\s　]+/)[0] ?? title;
}

export function chapterDotted(title: string): string {
  return title.trim().split(/[\s　]+/).join(' · ');
}

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

export function verticalTitle(title: string): boolean {
  return /^[㐀-鿿　-〿·・]{1,8}$/.test(title);
}
