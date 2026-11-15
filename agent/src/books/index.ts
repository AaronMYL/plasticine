// books/：图书。format/ 把上传的 EPUB、TXT、MOBI、AZW3 解析成同一种规范化的书（章节是受限 HTML 加浏览器里看到的
// 原文文字，还有用到的图），只解析、同步、纯函数、只用 Node 内置；其余是图书的业务——导入、书里找、按块取纯文字、
// 讨论归档、导出成笔记、Plasticine 给书写的大纲和重点、书对应的空间，和给内核的读书工具。数据在 state/，接口在 app/。

export type { BookFormat } from './format/draft.ts';
export { BOOK_ERROR_CODES, BookParseError } from './format/errors.ts';
export type { BookErrorCode } from './format/errors.ts';
export type { ParsedImage } from './format/images.ts';
export { BOOK_MAX_BYTES, detectBookFormat, parseBook } from './format/parse.ts';
export type { ParsedBook, ParsedChapter } from './format/parse.ts';
export { BookInsightService, anchorQuote } from './book-insights.ts';
export { askJson } from './book-model.ts';
export type { BookModel } from './book-model.ts';
export { publishBookSpace, refreshBookOutlineMarks } from './book-spaces.ts';
export { createBookTools } from './tools.ts';
export { bookDiscussions } from './book-discussions.ts';
export { bookNotesMarkdown } from './book-export-note.ts';
export { importBook } from './book-import.ts';
export { searchBook } from './book-search.ts';
