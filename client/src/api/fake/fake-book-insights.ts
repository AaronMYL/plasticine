import type { BookInsightKind, BookInsightView, BookKeyPoint, BookOutline } from '../shared.ts';

export type InsightRow = Omit<BookInsightView, 'stale' | 'status'> & { status: 'generating' | 'ready' | 'failed' };

const SUMMARY_CHARS = 40;
const KEY_POINT_LIMIT = 5;

function firstSentence(text: string): string {
  const end = text.search(/[。！？]/);
  return end < 0 ? text.slice(0, SUMMARY_CHARS) : text.slice(0, end + 1);
}

export function generatedInsight(kind: BookInsightKind, chapters: readonly { title: string; text: string }[],
  generatedAt: string): InsightRow {
  const base = { kind, status: 'ready' as const, dismissedPointIds: [], error: null, generatedAt };
  if (kind === 'outline') {
    const outline: BookOutline = {
      note: `按全书 ${chapters.length} 章逐章归纳，再合成`,
      parts: chapters.map((chapter, index) => ({ chapter: index, title: chapter.title,
        summary: chapter.text.slice(0, SUMMARY_CHARS), points: [] })),
    };
    return { ...base, outline, keyPoints: null };
  }
  const points: BookKeyPoint[] = chapters.slice(0, KEY_POINT_LIMIT).flatMap((chapter, index) => {
    const quote = firstSentence(chapter.text);
    return quote === '' ? [] : [{ id: `gen_kp${index + 1}`, text: `${chapter.title}从这一句起：${quote}`,
      basis: 'quoted' as const, anchors: [{ chapter: index, start: 0, end: quote.length, quote }] }];
  });
  return { ...base, outline: null, keyPoints: { points } };
}
