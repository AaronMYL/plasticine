// 这一章正文上要画什么：标注重新对上原文后的高亮（有批注的编个号）、Plasticine 还没收下也没「不要」的重点虚线，
// 页边放得下时右边那一列。纯计算，阅读页和测试共用。

import type { BookAnnotationView, BookInsightView } from '../../api/shared.ts';
import { reanchor } from './anchor.ts';
import type { HighlightMark, KeyPointMark } from './chapter-view.tsx';
import { pendingInChapter, type PendingKeyPoint } from './key-points.ts';
import { textNodes } from './text-offsets.ts';

export interface ChapterDecorations {
  highlights: HighlightMark[];
  keyPoints: PendingKeyPoint[];
  /** 这一章里对不上原文、没画出来的标注。 */
  unanchored: Set<string>;
}

/** 章节 html 的正文（textContent）：用 DOMParser 解析，不放进页面，插图不会被加载。 */
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

/** 跳到一处时闪一下的范围：没给终点就闪到这句话结束（最多 120 字）。 */
export function sentenceEnd(text: string, start: number): number {
  const rest = text.slice(start, start + 120);
  const stop = rest.search(/[。！？!?]/);
  return start + (stop < 0 ? Math.min(rest.length, 40) : stop + 1);
}
