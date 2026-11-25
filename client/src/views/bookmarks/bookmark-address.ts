import { bookmarkKey, type BookmarkView } from '../../api/shared.ts';
import type { WebTab, WebTabsStore } from '../../state/web-tabs.ts';

export type WebBookmark = BookmarkView & { kind: 'web'; target: string };

export function isWebBookmark(bookmark: BookmarkView): bookmark is WebBookmark {
  return bookmark.kind === 'web' && bookmark.target !== null;
}

export function webBookmarks(bookmarks: readonly BookmarkView[]): WebBookmark[] {
  return bookmarks.filter(isWebBookmark);
}

export function openTabFor(tabs: readonly WebTab[], url: string): WebTab | null {
  const key = bookmarkKey('web', url);
  return tabs.find((tab) => bookmarkKey('web', tab.url) === key) ?? null;
}

export function bookmarkTitle(bookmark: Pick<BookmarkView, 'title' | 'target'>): string {
  return bookmark.title.trim() === '' ? bookmark.target ?? '' : bookmark.title;
}

export function openBookmark(tabs: WebTabsStore, openWeb: (url: string, title: string) => void,
  bookmark: Pick<BookmarkView, 'title' | 'target'>): void {
  const target = bookmark.target;
  if (target === null) {
    return;
  }
  const open = openTabFor(tabs.get().tabs, target);
  if (open !== null) {
    openWeb(open.url, open.title);
    return;
  }
  openWeb(target, bookmarkTitle(bookmark));
}
