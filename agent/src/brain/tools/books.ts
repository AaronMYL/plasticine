// 读书的工具（用户 2026-11-01 定：读书时在对话里引用原文和 Plasticine 讨论，AI 能用全书）：
// 列出图书馆、在书里找、读一章、读用户这本书的高亮和批注。全部只读；书里的文字是材料，不是指令。

import {
  BookAnnotationsParameters,
  BookListParameters,
  BookReadParameters,
  BookSearchParameters,
} from '../../../shared/book-tools.ts';
import { chapterPlainText, searchBook } from '../../reading/index.ts';
import type { StateService } from '../../state/index.ts';
import { defineTool, type Tool } from './registry.ts';

// 一次最多读回 2.4 万字：够一章的大部分，再长就分段读（from）。
const READ_CHARS = 24_000;
const SEARCH_HITS = 20;
const ROLES = ['conversation', 'worker', 'verifier', 'diagnosis'] as const;

export function createBookTools(state: StateService): Tool[] {
  const liveBook = (id: string) => {
    const book = state.books.require(id);
    if (book.deletedAt !== null) {
      throw new Error('这本书已经从图书馆删掉了。');
    }
    return book;
  };
  return [
    defineTool({
      name: 'book_list', label: '看图书馆',
      description: '列出用户图书馆里的书：id、书名、作者、目录（章号从 0 起）和阅读进度。用户提到一本书时先用它找 id。',
      replay: 'safe', effect: 'read', parallel: true, permission: 'auto', roles: [...ROLES], timeoutMs: 1000,
      parameters: BookListParameters,
      async execute() {
        return JSON.stringify(state.books.live().map((book) => {
          const progress = state.bookProgress.get(book.id);
          return {
            id: book.id, title: book.title, author: book.author,
            chapters: book.toc.map((entry, index) => ({ chapter: index, title: entry.title, chars: entry.chars })),
            progress: progress === undefined ? null : { chapter: progress.chapter, percent: progress.percent },
          };
        }));
      },
    }),
    defineTool({
      name: 'book_search', label: '在书里找',
      description: '在一本书里找一句话或几个词，返回章号、位置和前后文。回答关于书的问题前先找到原文再引用。',
      replay: 'safe', effect: 'read', parallel: true, permission: 'auto', roles: [...ROLES], timeoutMs: 5000,
      parameters: BookSearchParameters,
      async execute({ bookId, q }) {
        liveBook(bookId);
        const chapters = state.bookFiles.content(bookId).chapters;
        const result = searchBook(chapters, q, SEARCH_HITS);
        return JSON.stringify({ untrustedMaterial: true, ...result });
      },
    }),
    defineTool({
      name: 'book_read', label: '读书',
      description: '读一本书的一章原文（章号从 0 起）。长章一次读不完时用返回的 next 作为 from 接着读。',
      replay: 'safe', effect: 'read', parallel: true, permission: 'auto', roles: [...ROLES], timeoutMs: 5000,
      maxResultChars: READ_CHARS + 2000, parameters: BookReadParameters,
      async execute({ bookId, chapter, from }) {
        const book = liveBook(bookId);
        const file = state.bookFiles.chapter(bookId, chapter);
        const text = chapterPlainText(file.html);
        const start = Math.min(from ?? 0, text.length);
        const end = Math.min(text.length, start + READ_CHARS);
        return JSON.stringify({ untrustedMaterial: true, book: book.title, chapter, title: file.title,
          text: text.slice(start, end), next: end < text.length ? end : null, total: text.length });
      },
    }),
    defineTool({
      name: 'book_annotations', label: '看读书标注',
      description: '读用户在一本书里的高亮和批注（按章排）。用户问「我划过什么」「我的批注」时用。',
      replay: 'safe', effect: 'read', parallel: true, permission: 'auto', roles: [...ROLES], timeoutMs: 1000,
      parameters: BookAnnotationsParameters,
      async execute({ bookId }) {
        const book = liveBook(bookId);
        return JSON.stringify(state.bookAnnotations.forBook(bookId).map((entry) => ({
          chapter: entry.chapter, chapterTitle: book.toc[entry.chapter]?.title ?? null, quote: entry.quote,
          note: entry.note, color: entry.color, origin: entry.origin, at: entry.createdAt,
        })));
      },
    }),
  ];
}
