import type { BookAnnotationView, BookInsightView, BookKeyPoint, BookTocEntry } from '../../api/shared.ts';
import { reanchor, type TextRange } from './anchor.ts';
import { bookPercent, chapterShort, percentText } from './book-format.ts';

export interface PendingKeyPoint extends TextRange {
  pointId: string;
  text: string;
  quote: string;
  chapter: number;
}

function isAccepted(annotations: readonly BookAnnotationView[], chapter: number, quote: string): boolean {
  return annotations.some((annotation) => annotation.origin === 'plasticine' && annotation.chapter === chapter
    && annotation.quote === quote);
}

export function visiblePoints(insight: BookInsightView | null): BookKeyPoint[] {
  if (insight?.keyPoints == null) {
    return [];
  }
  return insight.keyPoints.points.filter((point) => !insight.dismissedPointIds.includes(point.id));
}

export function pendingInChapter(insight: BookInsightView | null, annotations: readonly BookAnnotationView[],
  chapter: number, chapterText: string): PendingKeyPoint[] {
  return visiblePoints(insight).flatMap((point) => point.anchors
    .filter((anchor) => anchor.chapter === chapter && !isAccepted(annotations, chapter, anchor.quote))
    .flatMap((anchor) => {
      const range = reanchor(chapterText, anchor);
      return range === null ? [] : [{ ...range, pointId: point.id, text: point.text, quote: anchor.quote, chapter }];
    }));
}

export function pointSource(point: BookKeyPoint, toc: readonly BookTocEntry[]): string {
  const first = point.anchors[0];
  if (point.basis === 'inferred' || first === undefined) {
    return '推断 · 没有直接原文';
  }
  const chapters = [...new Set(point.anchors.map((anchor) => anchor.chapter))]
    .map((index) => chapterShort(toc[index]?.title ?? `第 ${index + 1} 章`));
  const where = chapters.length === 1
    ? `${chapters[0]} · ${percentText(bookPercent(toc, first.chapter, first.start))}` : chapters.join('、');
  return `${where} · 有原文 ${point.anchors.length} 处`;
}
