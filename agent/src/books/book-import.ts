import { createHash, randomUUID } from 'node:crypto';
import { BOOK_AUTHOR_MAX_CHARS, BOOK_TITLE_MAX_CHARS, type BookRecord } from '../../shared/state.ts';
import { parseBook } from './format/parse.ts';
import type { StateService } from '../state/index.ts';

export interface ImportedBook {
  book: BookRecord;
  duplicate: boolean;
  restored: boolean;
}

function clip(text: string, max: number): string {
  return Array.from(text.trim()).slice(0, max).join('');
}

export function importBook(state: StateService, input: { fileName: string; bytes: Buffer }): ImportedBook {
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const existing = state.books.findBySource(sha256);
  if (existing !== undefined) {
    return { book: existing, duplicate: true, restored: false };
  }
  const deleted = state.books.findDeletedBySource(sha256);
  if (deleted !== undefined) {
    return { book: state.books.update(deleted.id, deleted.version, { deletedAt: null }), duplicate: true,
      restored: true };
  }
  const parsed = parseBook({ fileName: input.fileName, bytes: input.bytes });
  const id = randomUUID();
  const chapters = parsed.chapters.map((chapter) => ({ title: chapter.title, html: chapter.html, text: chapter.text }));
  const images = [...parsed.images];
  if (parsed.cover !== null && !images.some((image) => image.key === parsed.cover?.key)) {
    images.push(parsed.cover);
  }
  state.bookFiles.write(id, { source: input.bytes, format: parsed.format, chapters, images });
  const title = clip(parsed.title, BOOK_TITLE_MAX_CHARS);
  const author = parsed.author === null ? null : clip(parsed.author, BOOK_AUTHOR_MAX_CHARS);
  const book = state.books.create({
    title: title === '' ? clip(input.fileName, BOOK_TITLE_MAX_CHARS) : title,
    author: author === '' ? null : author,
    language: parsed.language === null ? null : clip(parsed.language, 40),
    format: parsed.format,
    fileName: clip(input.fileName, 400),
    sourceBytes: input.bytes.length,
    sourceSha256: sha256,
    coverAsset: parsed.cover?.key ?? null,
    toc: chapters.map((chapter) => ({ title: chapter.title, chars: chapter.text.length })),
    charCount: chapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
  }, id);
  return { book, duplicate: false, restored: false };
}
