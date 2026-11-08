// 图书接口的视图：把 state/ 的行拼成 shared/api/books.ts 的样子，界面不碰表结构。

import {
  BOOKS_PATH,
  type BookAnnotationView,
  type BookInsightView,
  type BookView,
} from '../../shared/api/index.ts';
import type {
  BookAnnotation,
  BookInsight,
  BookInsightKind,
  BookKeyPoints,
  BookOutline,
  BookRecord,
} from '../../shared/state.ts';
import { BookKeyPointsSchema, BookOutlineSchema } from '../../shared/state.ts';
import { Value } from 'typebox/value';
import type { StateService } from '../state/index.ts';

export function bookAssetUrl(bookId: string, key: string): string {
  return `${BOOKS_PATH}/${encodeURIComponent(bookId)}/assets/${encodeURIComponent(key)}`;
}

export function bookView(state: StateService, book: BookRecord): BookView {
  const progress = state.bookProgress.get(book.id);
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    fileName: book.fileName,
    sourceBytes: book.sourceBytes,
    coverUrl: book.coverAsset === null ? null : bookAssetUrl(book.id, book.coverAsset),
    toc: book.toc,
    charCount: book.charCount,
    progress: progress === undefined ? null : {
      chapter: progress.chapter,
      offset: progress.offset,
      percent: progress.percent,
      deviceLabel: progress.deviceLabel,
      updatedAt: progress.updatedAt,
      version: progress.version,
    },
    annotationCount: state.bookAnnotations.forBook(book.id).length,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    lastOpenedAt: book.lastOpenedAt,
    version: book.version,
  };
}

export function annotationView(annotation: BookAnnotation): BookAnnotationView {
  return {
    id: annotation.id,
    bookId: annotation.bookId,
    chapter: annotation.chapter,
    start: annotation.start,
    end: annotation.end,
    quote: annotation.quote,
    prefix: annotation.prefix,
    suffix: annotation.suffix,
    color: annotation.color,
    note: annotation.note,
    origin: annotation.origin,
    deviceLabel: annotation.deviceLabel,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
    version: annotation.version,
  };
}

export function insightView(book: BookRecord, kind: BookInsightKind, row: BookInsight | undefined): BookInsightView {
  if (row === undefined) {
    return { kind, status: 'none', outline: null, keyPoints: null, dismissedPointIds: [], error: null,
      generatedAt: null, stale: false };
  }
  const outline: BookOutline | null = kind === 'outline' && Value.Check(BookOutlineSchema, row.content)
    ? row.content : null;
  const keyPoints: BookKeyPoints | null = kind === 'key_points' && Value.Check(BookKeyPointsSchema, row.content)
    ? row.content : null;
  return {
    kind,
    status: row.status,
    outline,
    keyPoints,
    dismissedPointIds: row.dismissedPointIds,
    error: row.error,
    generatedAt: row.generatedAt,
    stale: row.status === 'ready' && row.sourceSha256 !== book.sourceSha256,
  };
}
