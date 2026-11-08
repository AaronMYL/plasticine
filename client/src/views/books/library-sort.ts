// 图书馆的排序和页头那一行数：最近（最近打开的在前，没打开过的按导入时间）/ 书名 / 作者（按中文排）。

import type { BookView } from '../../api/shared.ts';
import { isReading } from './book-format.ts';

export type LibrarySort = 'recent' | 'title' | 'author';

export const SORT_LABELS: Readonly<Record<LibrarySort, string>> = { recent: '最近', title: '书名', author: '作者' };

const collator = new Intl.Collator('zh-CN');

function recentAt(book: BookView): string {
  return book.progress?.updatedAt ?? book.lastOpenedAt ?? book.createdAt;
}

export function sortBooks(books: readonly BookView[], sort: LibrarySort): BookView[] {
  const copy = [...books];
  if (sort === 'title') {
    return copy.sort((a, b) => collator.compare(a.title, b.title));
  }
  if (sort === 'author') {
    return copy.sort((a, b) => collator.compare(a.author ?? '', b.author ?? '') || collator.compare(a.title, b.title));
  }
  return copy.sort((a, b) => recentAt(b).localeCompare(recentAt(a)));
}
