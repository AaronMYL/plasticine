// 把 books-seed.ts 的示例装进假图书馆：书、进度、标注、Plasticine 的大纲和重点，再在主线里放两轮
// 引用过《浮生六记》的讨论（「讨论」tab 和对话栏里的书引用片都从这里来）。

import { withResolvedQuotes, type LineMessageView } from '../shared.ts';
import type { BookAnnotationView, BookProgressView } from '../shared.ts';
import { FUSHENG_ID, SEED_ANNOTATIONS, SEED_BOOKS, SEED_KEY_POINTS, SEED_OUTLINE } from './books-seed.ts';
import type { FakeBooks } from './fake-books.ts';
import { anchorIn, chapterOf, type FakeChapter } from './fake-book-text.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';

const HOUR_MS = 3_600_000;
// 预置标注前后各留多少字的上下文：和服务端上限（BOOK_CONTEXT_CHARS）一样。
const CONTEXT_CHARS = 32;

function percentAt(chapters: readonly FakeChapter[], chapter: number, offset: number): number {
  const total = chapters.reduce((sum, item) => sum + item.text.length, 0);
  const before = chapters.slice(0, chapter).reduce((sum, item) => sum + item.text.length, 0);
  return total === 0 ? 0 : Math.min(1, (before + offset) / total);
}

function seedLibrary(books: FakeBooks, now: Date): Map<string, FakeChapter[]> {
  const ago = (hours: number): string => new Date(now.getTime() - hours * HOUR_MS).toISOString();
  const texts = new Map<string, FakeChapter[]>();
  for (const seed of SEED_BOOKS) {
    const chapters = seed.chapters.map((_, index) => chapterOf(seed.chapters, index));
    texts.set(seed.id, chapters);
    let progress: BookProgressView | null = null;
    if (seed.progress !== undefined) {
      const text = chapters[seed.progress.chapter]?.text ?? '';
      // 原句写空串表示读到了最后（「读完」）。
      const offset = seed.progress.quote === '' ? text.length : anchorIn(text, seed.progress.quote).start;
      progress = { chapter: seed.progress.chapter, offset, deviceLabel: seed.progress.deviceLabel,
        percent: percentAt(chapters, seed.progress.chapter, offset), updatedAt: ago(seed.progress.hoursAgo),
        version: 3 };
    }
    const sourceBytes = chapters.reduce((sum, chapter) => sum + chapter.text.length * 3, 0);
    books.seedBook({ id: seed.id, title: seed.title, author: seed.author, format: seed.format,
      fileName: seed.fileName, sourceBytes, coverUrl: null, progress, createdAt: ago(24 * 30), updatedAt: ago(1),
      lastOpenedAt: seed.openedHoursAgo === undefined ? null : ago(seed.openedHoursAgo) }, chapters);
  }
  return texts;
}

function seedNotes(books: FakeBooks, texts: Map<string, FakeChapter[]>, now: Date): void {
  SEED_ANNOTATIONS.forEach((seed, index) => {
    const text = texts.get(seed.bookId)?.[seed.chapter]?.text ?? '';
    const { start, end } = anchorIn(text, seed.quote);
    const at = new Date(now.getTime() - seed.hoursAgo * HOUR_MS).toISOString();
    const annotation: BookAnnotationView = { id: `seed_ann_${index + 1}`, bookId: seed.bookId, chapter: seed.chapter,
      start, end, quote: seed.quote, prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      suffix: text.slice(end, end + CONTEXT_CHARS), color: seed.color, note: seed.note, origin: seed.origin,
      deviceLabel: seed.deviceLabel, createdAt: at, updatedAt: at, version: 1 };
    books.seedAnnotation(annotation);
  });
  const chapters = texts.get(FUSHENG_ID) ?? [];
  books.seedInsight(SEED_OUTLINE.bookId, { kind: 'outline', status: 'ready', outline: SEED_OUTLINE.outline,
    keyPoints: null, dismissedPointIds: [], error: null,
    generatedAt: new Date(now.getTime() - 2 * HOUR_MS).toISOString() });
  const points = SEED_KEY_POINTS.points.map((point) => ({ id: point.id, text: point.text, basis: point.basis,
    anchors: point.anchors.map((anchor) => ({ chapter: anchor.chapter, quote: anchor.quote,
      ...anchorIn(chapters[anchor.chapter]?.text ?? '', anchor.quote) })) }));
  books.seedInsight(SEED_KEY_POINTS.bookId, { kind: 'key_points', status: 'ready', outline: null,
    keyPoints: { points }, dismissedPointIds: [], error: null,
    generatedAt: new Date(now.getTime() - 1.9 * HOUR_MS).toISOString() });
}

function said(role: 'user' | 'assistant', text: string, at: Date): Omit<LineMessageView, 'lineId' | 'seq'> {
  return { role, text, origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null,
    say: null, ok: null,
    summary: null, stopReason: role === 'assistant' ? 'stop' : null, childLineId: null, attachments: [], widgets: [],
    createdAt: at.toISOString() };
}

function seedDiscussions(books: FakeBooks, lines: FakeLines, now: Date): void {
  const turns = [
    { quote: '东坡云：“事如春梦了无痕”，苟不记之笔墨，未免有辜彼苍之厚。', chapter: 0, minutesAgo: 30,
      question: '“事如春梦了无痕”这句东坡原诗是什么？他引它想说什么？',
      conclusion: '出自苏轼《正月二十日与潘郭二生出郊寻春》，沈复借它说：日子过去不留痕，所以要写下来。',
      reasoning: '原诗上一句是“人似秋鸿来有信”。沈复只取后半，把“无痕”反过来用：既然会无痕，就由笔墨来留痕。'
        + '这也是全书写作的动机。' },
    { quote: '布衣菜饭，可乐终身，不必作远游计矣。', chapter: 0, minutesAgo: 60 * 26 + 30,
      question: '芸说“布衣菜饭，可乐终身”，和现在说的极简生活有什么不一样？',
      conclusion: '她说的是和谁一起过，不是东西少；后面卷三的贫苦正好反过来照见这句。', reasoning: '' },
  ];
  turns.forEach((turn, index) => {
    const text = books.chapterText(FUSHENG_ID, turn.chapter);
    const { start, end } = anchorIn(text, turn.quote);
    const quote = books.resolveQuote({ bookId: FUSHENG_ID, chapter: turn.chapter, start, end, text: turn.quote });
    const askedAt = new Date(now.getTime() - turn.minutesAgo * 60_000);
    lines.record(MAIN_LINE_ID, said('user', withResolvedQuotes(turn.question, [quote]), askedAt),
      { kind: 'user', userText: turn.question });
    const answer = turn.reasoning === '' ? turn.conclusion : `${turn.conclusion}\n\n${turn.reasoning}`;
    lines.record(MAIN_LINE_ID, said('assistant', answer, new Date(askedAt.getTime() + 60_000)));
  });
}

export function seedBooks(books: FakeBooks, lines: FakeLines, now: Date): void {
  const texts = seedLibrary(books, now);
  seedNotes(books, texts, now);
  seedDiscussions(books, lines, now);
}
