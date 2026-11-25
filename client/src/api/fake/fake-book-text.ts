import type { SeedChapter } from './books-seed.ts';

export interface FakeChapter {
  title: string;
  html: string;
  text: string;
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

export function chapterOf(chapters: readonly SeedChapter[] | readonly FakeChapter[], index: number): FakeChapter {
  const chapter = chapters[index];
  if (chapter === undefined) {
    throw new Error(`预置的书没有第 ${index + 1} 章`);
  }
  if ('html' in chapter) {
    return chapter;
  }
  return {
    title: chapter.title,
    html: chapter.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(''),
    text: chapter.paragraphs.join(''),
  };
}

export function plainChapters(chapters: readonly FakeChapter[]): { title: string; text: string }[] {
  return chapters.map((chapter) => ({ title: chapter.title, text: chapter.text }));
}

export function anchorIn(text: string, quote: string): { start: number; end: number } {
  const start = text.indexOf(quote);
  if (start < 0) {
    throw new Error(`预置的原句不在这一章里：${quote}`);
  }
  return { start, end: start + quote.length };
}
