// 假图书馆的章节：段落拼成和真服务端规范后一样的 html（只有 <p>，块之间没有空白），
// 所以浏览器里容器的 textContent 正好等于段落直接连起来的正文，高亮下标两边对得上。

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

/** 原句在章里的位置：预置标注和重点只写原句，下标在这里算，免得手数字数出错。 */
export function anchorIn(text: string, quote: string): { start: number; end: number } {
  const start = text.indexOf(quote);
  if (start < 0) {
    throw new Error(`预置的原句不在这一章里：${quote}`);
  }
  return { start, end: start + quote.length };
}
