// 书签和开着的标签对不对得上（第 8 批第 1 条，11-09 他定：书签是存的网站地址，标签是现在开着的网站）。同一个网页按
// shared 的 bookmarkKey 比（主机名小写、去掉末尾的 #）：书签行尾的小点、点书签切到开着的那个、⌘K 都用这一份。

import { bookmarkKey, type BookmarkView } from '../../api/shared.ts';
import type { WebTab, WebTabsStore } from '../../state/web-tabs.ts';

/** 网页书签（有网址）；Plasticine 自己的页面、保存的分组不在网页栏里列。 */
export type WebBookmark = BookmarkView & { kind: 'web'; target: string };

export function isWebBookmark(bookmark: BookmarkView): bookmark is WebBookmark {
  return bookmark.kind === 'web' && bookmark.target !== null;
}

export function webBookmarks(bookmarks: readonly BookmarkView[]): WebBookmark[] {
  return bookmarks.filter(isWebBookmark);
}

/** 开着同一个网页的标签（没有是 null）。 */
export function openTabFor(tabs: readonly WebTab[], url: string): WebTab | null {
  const key = bookmarkKey('web', url);
  return tabs.find((tab) => bookmarkKey('web', tab.url) === key) ?? null;
}

/** 书签的名字：空的写网址。 */
export function bookmarkTitle(bookmark: Pick<BookmarkView, 'title' | 'target'>): string {
  return bookmark.title.trim() === '' ? bookmark.target ?? '' : bookmark.title;
}

/**
 * 点一个书签：同一个网址已经开着就切到那个标签，否则新开一个（进「今天」）并切过去；书签本身永远不变。
 * openWeb 是壳的打开网页（桌面客户端开成竖排标签并切过去，网页版在新窗口打开、也记进「今天」）。
 */
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
