import type { BookView, NoteMetaView } from '../../api/shared.ts';
import type { ArchivedTab, WebTab } from '../../state/web-tabs.ts';

export const CONTINUE_MAX = 6;
const BOOK_DONE_PERCENT = 0.99;

export type ContinueItem =
  | { key: string; kind: 'note'; id: string; title: string; at: string | null }
  | { key: string; kind: 'book'; id: string; title: string; at: string | null; percent: number }
  | { key: string; kind: 'web'; url: string; title: string; at: string | null; open: boolean };

export interface ContinueSources {
  notes: readonly NoteMetaView[];
  books: readonly BookView[];
  tabs: readonly WebTab[];
  closed: readonly ArchivedTab[];
}

function noteItems(notes: readonly NoteMetaView[]): ContinueItem[] {
  return notes.filter((note) => note.deletedAt === null).map((note) => ({
    key: `note:${note.id}`, kind: 'note', id: note.id, title: note.title.trim() || '无标题', at: note.updatedAt,
  }));
}

function bookItems(books: readonly BookView[]): ContinueItem[] {
  return books.flatMap((book) => {
    const progress = book.progress;
    if (progress === null || progress.percent >= BOOK_DONE_PERCENT) {
      return [];
    }
    return [{ key: `book:${book.id}`, kind: 'book' as const, id: book.id, title: book.title,
      at: progress.updatedAt, percent: progress.percent }];
  });
}

function webItems(tabs: readonly WebTab[], closed: readonly ArchivedTab[]): ContinueItem[] {
  const open: ContinueItem[] = tabs.map((tab) => ({ key: `web:${tab.id}`, kind: 'web' as const, url: tab.url,
    title: tab.title || tab.url, at: tab.visitedAt, open: true }));
  const openUrls = new Set(tabs.map((tab) => tab.url));
  const gone: ContinueItem[] = closed.flatMap((entry) => openUrls.has(entry.url) ? []
    : [{ key: `closed:${entry.key}`, kind: 'web' as const, url: entry.url, title: entry.title || entry.url,
      at: entry.closedAt, open: false }]);
  return [...open, ...gone];
}

function byRecent(a: ContinueItem, b: ContinueItem): number {
  if (a.at !== null && b.at !== null) {
    return b.at.localeCompare(a.at);
  }
  if (a.at === b.at) {
    return 0;
  }
  return a.at === null ? 1 : -1;
}

export function continueItems(sources: ContinueSources): ContinueItem[] {
  const items = [...noteItems(sources.notes), ...bookItems(sources.books),
    ...webItems(sources.tabs, sources.closed)];
  return items.sort(byRecent).slice(0, CONTINUE_MAX);
}
