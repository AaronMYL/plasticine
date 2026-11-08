// books/: turns uploaded EPUB, TXT, MOBI and AZW3 files into one normalized book — chapters as restricted HTML plus
// the exact text a browser shows for it, and the images they use. Parsing only: storage and the reader live
// elsewhere. Synchronous and pure, Node built-ins only.

export type { BookFormat } from './draft.ts';
export { BOOK_ERROR_CODES, BookParseError } from './errors.ts';
export type { BookErrorCode } from './errors.ts';
export type { ParsedImage } from './images.ts';
export { BOOK_MAX_BYTES, detectBookFormat, parseBook } from './parse.ts';
export type { ParsedBook, ParsedChapter } from './parse.ts';
