// Plasticine 标的重点在阅读页上的样子：哪几处还要在原文里画虚线（没「不要」、也没「收下」的），每条重点的出处
// 那一行怎么写。收下的重点变成一条 origin = plasticine 的标注；标注里没有重点编号，按同章同原句认出来。

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

export function pointAccepted(point: BookKeyPoint, annotations: readonly BookAnnotationView[]): boolean {
  return point.anchors.some((anchor) => isAccepted(annotations, anchor.chapter, anchor.quote));
}

/** 这一章里还要画虚线的几处：重新对上原文，对不上的不画。 */
export function pendingInChapter(insight: BookInsightView | null, annotations: readonly BookAnnotationView[],
  chapter: number, chapterText: string): PendingKeyPoint[] {
  return visiblePoints(insight).flatMap((point) => point.anchors
    .filter((anchor) => anchor.chapter === chapter && !isAccepted(annotations, chapter, anchor.quote))
    .flatMap((anchor) => {
      const range = reanchor(chapterText, anchor);
      return range === null ? [] : [{ ...range, pointId: point.id, text: point.text, quote: anchor.quote, chapter }];
    }));
}

/** 「卷一 · 2% · 有原文 2 处」；推断出来的写「推断 · 没有直接原文」。 */
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
