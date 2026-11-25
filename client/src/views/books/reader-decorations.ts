import type { BookAnnotationView, BookInsightView } from '../../api/shared.ts';
import { reanchor } from './anchor.ts';
import type { HighlightMark, KeyPointMark } from './chapter-view.tsx';
import { pendingInChapter, type PendingKeyPoint } from './key-points.ts';
import { textNodes } from './text-offsets.ts';

export interface ChapterDecorations {
  highlights: HighlightMark[];
  keyPoints: PendingKeyPoint[];
  unanchored: Set<string>;
}

export function htmlText(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return textNodes(parsed.body).map((node) => node.data).join('');
}

export function chapterDecorations(input: {
  chapter: number;
  text: string;
  annotations: readonly BookAnnotationView[];
  keyPoints: BookInsightView | null;
  showKeyPoints: boolean;
}): ChapterDecorations {
  const highlights: HighlightMark[] = [];
  const unanchored = new Set<string>();
  let notes = 0;
  for (const annotation of input.annotations) {
    if (annotation.chapter !== input.chapter) {
      continue;
    }
    const range = reanchor(input.text, annotation);
    if (range === null) {
      unanchored.add(annotation.id);
      continue;
    }
    if (annotation.note !== null) {
      notes += 1;
    }
    highlights.push({ id: annotation.id, start: range.start, end: range.end, color: annotation.color,
      plasticine: annotation.origin === 'plasticine', noteIndex: annotation.note === null ? null : notes });
  }
  const keyPoints = input.showKeyPoints
    ? pendingInChapter(input.keyPoints, input.annotations, input.chapter, input.text) : [];
  return { highlights, keyPoints, unanchored };
}

export function keyPointMarks(points: readonly PendingKeyPoint[]): KeyPointMark[] {
  return points.map((point) => ({ pointId: point.pointId, start: point.start, end: point.end }));
}

export function sentenceEnd(text: string, start: number): number {
  const rest = text.slice(start, start + 120);
  const stop = rest.search(/[。！？!?]/);
  return start + (stop < 0 ? Math.min(rest.length, 40) : stop + 1);
}
