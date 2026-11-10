// 图书笔记复用已生成的结构化内容，一种 insight 固定对应一个空间，编辑后的页面不被读取操作覆盖。
import { Value } from 'typebox/value';
import { renderBookPage } from '../../shared/book-space-page.ts';
import { BookKeyPointsSchema, BookOutlineSchema, type BookInsight, type BookInsightKind, type BookRecord,
  type Space } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { writeSpace } from '../subs/index.ts';

export function bookSpaceSource(bookId: string, kind: BookInsightKind): string {
  return `book:${bookId}:${kind}`;
}

export function publishBookSpace(state: StateService, book: BookRecord, row: BookInsight,
  rewrite = false): Space | null {
  if (row.status !== 'ready' || book.deletedAt !== null) return null;
  const outline = row.kind === 'outline' && Value.Check(BookOutlineSchema, row.content) ? row.content : undefined;
  const keyPoints = row.kind === 'key_points' && Value.Check(BookKeyPointsSchema, row.content)
    ? row.content : undefined;
  if (outline === undefined && keyPoints === undefined) return null;
  const sourceUrl = bookSpaceSource(book.id, row.kind);
  return state.transaction(() => {
    const existing = state.spaces.findBySourceUrl(sourceUrl, 'booknote', true);
    if (existing?.deletedAt != null) return null;
    if (existing !== undefined && !rewrite) return existing;
    const title = `${book.title} · ${row.kind === 'outline' ? '大纲' : '重点'}`.slice(0, 120);
    const html = renderBookPage({ bookId: book.id, toc: book.toc,
      currentChapter: state.bookProgress.get(book.id)?.chapter ?? null, dismissedPointIds: row.dismissedPointIds,
      ...(outline === undefined ? {} : { outline }), ...(keyPoints === undefined ? {} : { keyPoints }) });
    return writeSpace(state, { title, html, genre: 'report', category: 'booknote', sourceUrl, bookId: book.id,
      folder: existing?.folder ?? book.folder ?? null,
      ...(existing === undefined ? {} : { id: existing.id, version: existing.version }) }, 'ai').space;
  });
}

export function backfillBookSpaces(state: StateService): number {
  let created = 0;
  for (const book of state.books.live()) {
    for (const kind of ['outline', 'key_points'] as const) {
      const row = state.bookInsights.find(book.id, kind);
      if (row !== undefined
        && state.spaces.findBySourceUrl(bookSpaceSource(book.id, kind), 'booknote', true) === undefined
        && publishBookSpace(state, book, row) !== null) created += 1;
    }
  }
  return created;
}
