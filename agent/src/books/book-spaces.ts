// 图书笔记复用已生成的结构化内容，一种 insight 固定对应一个空间，编辑后的页面不被读取操作覆盖。
import { Value } from 'typebox/value';
import { renderBookPage, type BookPageMarks } from '../../shared/book-space-page.ts';
import { BookKeyPointsSchema, BookOutlineSchema, type BookInsight, type BookInsightKind, type BookRecord,
  type Space } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { writeSpace } from '../subs/index.ts';

export function bookSpaceSource(bookId: string, kind: BookInsightKind): string {
  return `book:${bookId}:${kind}`;
}

export interface BookSummarySpaceSnapshot {
  space: Space;
  generated: boolean;
}

/**
 * 比对是不是原样的自动生成页时去掉会自己变的部分：阅读进度（页面打开时决定）、样式（模板改版）、高亮个数和摘句（随你的
 * 高亮变），免得把原模板误判成用户编辑。
 */
function withoutReadingPosition(html: string): string {
  return html.replace(/<span class="bn-current"(?: hidden)?>读到这里<\/span>/gu,
    '<span class="bn-current" hidden>读到这里</span>')
    .replace(/^<style>[\s\S]*?<\/style>/u, '')
    .replace(/<p class="bn-marks">[\s\S]*?<\/p>/gu, '')
    .replace(/<blockquote class="bn-quote">[\s\S]*?<\/blockquote>/gu, '');
}

/** 你在这本书上的高亮和批注：个数和摘句（按章、按位置排）。 */
export function bookMarks(state: StateService, bookId: string): BookPageMarks {
  const annotations = state.bookAnnotations.forBook(bookId)
    .sort((a, b) => a.chapter - b.chapter || a.start - b.start);
  return { highlights: annotations.length, notes: annotations.filter((item) => (item.note ?? '').trim() !== '').length,
    quotes: annotations.map((item) => ({ chapter: item.chapter, quote: item.quote })) };
}

export function bookSummarySpaceSnapshot(state: StateService, book: BookRecord, row: BookInsight,
  space: Space): BookSummarySpaceSnapshot {
  const outline = Value.Check(BookOutlineSchema, row.content) ? row.content : undefined;
  if (outline === undefined) return { space, generated: false };
  const input = { bookId: book.id, toc: book.toc, currentChapter: null, outline };
  // 只认旧生成器的精确产物。保留旧回退算法仅用于识别，绝不再把它展示成总述。
  const legacySummary = outline.summary || [...outline.parts].filter((part) => part.chapter < book.toc.length)
    .sort((a, b) => a.chapter - b.chapter).map((part) => part.summary).filter(Boolean).join(' ').slice(0, 400);
  const inputs = [input, { ...input, outline: { ...outline, summary: legacySummary } }];
  // 11-11 以前的版式带色条：同样算自动生成的，好换成新版式。
  const expected = inputs.flatMap((item) => [renderBookPage(item), renderBookPage(item, { legacy: true })])
    .map(withoutReadingPosition);
  const revision = state.spaces.revision(space.id, space.version);
  const generated = space.author === 'ai' && space.category === 'booknote' && space.bookId === book.id
    && space.title === `${book.title} · 大纲`.slice(0, 120)
    && space.sourceUrl === bookSpaceSource(book.id, 'outline') && space.genre === 'report'
    && space.html !== null && expected.includes(withoutReadingPosition(space.html))
    && revision?.html === space.html
    && state.spaces.revisions(space.id).every((item) => item.author === 'ai');
  return { space, generated };
}

/** 原版必须仍在修订记录中；模型等待期间改过或删过页面，就只补源数据，保留页面。 */
export function publishBookSummary(state: StateService, book: BookRecord, row: BookInsight,
  snapshot: BookSummarySpaceSnapshot): Space | null {
  if (!snapshot.generated) return null;
  const current = state.spaces.get(snapshot.space.id);
  if (current === undefined || current.deletedAt !== null || current.version !== snapshot.space.version
    || current.html !== snapshot.space.html || current.author !== 'ai'
    || current.bookId !== book.id || current.category !== 'booknote'
    || current.sourceUrl !== bookSpaceSource(book.id, 'outline')
    || state.spaces.revision(current.id, current.version)?.html !== current.html) return null;
  return publishBookSpace(state, book, row, true);
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
      ...(row.kind === 'outline' ? { marks: bookMarks(state, book.id) } : {}),
      ...(outline === undefined ? {} : { outline }), ...(keyPoints === undefined ? {} : { keyPoints }) });
    if (existing !== undefined && existing.html === html && existing.title === title) return existing;
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

/** 11-11 版式升级：还是自动生成、没被改过的旧大纲页（带色条、没有高亮个数）换成新版式；改过的不动。返回换了几页。 */
export function upgradeBookOutlineLayouts(state: StateService): number {
  let upgraded = 0;
  for (const book of state.books.live()) {
    const row = state.bookInsights.find(book.id, 'outline');
    const space = state.spaces.findBySourceUrl(bookSpaceSource(book.id, 'outline'), 'booknote', true);
    if (row === undefined || space === undefined || space.deletedAt !== null
      || (space.html ?? '').includes('class="bn-marks"')) continue;
    const snapshot = bookSummarySpaceSnapshot(state, book, row, space);
    if (snapshot.generated && publishBookSpace(state, book, row, true) !== null) upgraded += 1;
  }
  return upgraded;
}

/** 高亮或批注变了：还是自动生成、没被改过的大纲页跟着换个数和摘句；改过的不动。 */
export function refreshBookOutlineMarks(state: StateService, book: BookRecord): Space | null {
  const row = state.bookInsights.find(book.id, 'outline');
  const space = state.spaces.findBySourceUrl(bookSpaceSource(book.id, 'outline'), 'booknote', true);
  if (row === undefined || space === undefined || space.deletedAt !== null) return null;
  if (!bookSummarySpaceSnapshot(state, book, row, space).generated) return null;
  return publishBookSpace(state, book, row, true);
}
