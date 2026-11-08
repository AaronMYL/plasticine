// 把一本书的标注导出成一篇笔记（用户 2026-11-01 定：标注存在书里，可一键导出成笔记；之后两边不自动同步）。

import type { BookAnnotation, BookRecord } from '../../shared/state.ts';

function quoteBlock(text: string): string {
  return text.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
}

export function bookNotesMarkdown(book: BookRecord, annotations: readonly BookAnnotation[], exportedAt: string): string {
  const lines: string[] = [`# 《${book.title}》读书笔记`, ''];
  const byline = [book.author, `${annotations.length} 条标注`, `导出于 ${exportedAt.slice(0, 10)}`];
  lines.push(byline.filter((part) => part !== null).join(' · '), '');
  let chapter = -1;
  for (const annotation of annotations) {
    if (annotation.chapter !== chapter) {
      chapter = annotation.chapter;
      lines.push(`## ${book.toc[chapter]?.title ?? `第 ${chapter + 1} 章`}`, '');
    }
    lines.push(quoteBlock(annotation.quote), '');
    if (annotation.note !== null && annotation.note.trim() !== '') {
      lines.push(`批注：${annotation.note.trim()}`, '');
    }
    if (annotation.origin === 'plasticine') {
      lines.push('（Plasticine 标的重点，你收下的）', '');
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}
