// The one entry point: sniff the format, run its parser, then apply the rules every format shares — drop chapters
// without text, number untitled ones, split very long ones at block boundaries, export only the images that kept
// chapters (and the cover) use. Synchronous and pure: bytes in, a book out, no files and no network.

import { blockText, renderBlocks } from './blocks.ts';
import type { Block } from './blocks.ts';
import type { BookFormat, DraftBook } from './draft.ts';
import { parseEpub } from './epub.ts';
import { BOOK_MESSAGES, BookParseError, corrupt } from './errors.ts';
import type { ParsedImage } from './images.ts';
import { mobiFormatOf, parseMobi } from './mobi.ts';
import { isPdbBook } from './pdb.ts';
import { parseTxt } from './txt.ts';

export interface ParsedChapter {
  /** From the TOC / nav / NCX or the first heading; fallback 「第 N 章」. */
  title: string;
  /** Normalized HTML (see blocks.ts): a fixed set of tags, attributes only on img. */
  html: string;
  /** Exactly the textContent a browser computes for `html`. */
  text: string;
}

export interface ParsedBook {
  format: BookFormat;
  title: string;
  author: string | null;
  language: string | null;
  cover: ParsedImage | null;
  /** Reading order, never empty. */
  chapters: ParsedChapter[];
  /** Every image the chapters reference, plus the cover. */
  images: ParsedImage[];
}

// The upload limit for one book (task brief); larger files are refused before any parsing.
export const BOOK_MAX_BYTES = 100 * 1024 * 1024;
// A chapter past this many characters is split: the reader renders a chapter at once, and very long DOMs stutter.
export const CHAPTER_MAX_CHARS = 60_000;
const UNTITLED_BOOK = '未命名';

const EXTENSION_FORMATS: Record<string, BookFormat> = {
  epub: 'epub',
  txt: 'txt',
  mobi: 'mobi',
  prc: 'mobi',
  azw: 'mobi',
  azw3: 'azw3',
  kf8: 'azw3',
};

function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).at(-1) ?? '';
}

function extensionOf(fileName: string): string {
  const name = baseName(fileName);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function stemOf(fileName: string): string {
  const name = baseName(fileName);
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).trim();
}

function isZip(bytes: Buffer): boolean {
  const signature = bytes.length >= 4 ? bytes.readUInt32LE(0) : 0;
  return signature === 0x04034b50 || signature === 0x06054b50;
}

/** EPUB requires a stored "mimetype" entry first, so the media type sits at a fixed place in the first bytes. */
function hasEpubMimetype(bytes: Buffer): boolean {
  if (bytes.length < 30 || bytes.readUInt32LE(0) !== 0x04034b50) {
    return false;
  }
  const nameLength = bytes.readUInt16LE(26);
  const extraLength = bytes.readUInt16LE(28);
  const name = bytes.subarray(30, 30 + nameLength).toString('latin1');
  const data = 30 + nameLength + extraLength;
  return name === 'mimetype' && bytes.subarray(data, data + 20).toString('latin1') === 'application/epub+zip';
}

function hasTextBom(bytes: Buffer): boolean {
  const first = bytes[0];
  const second = bytes[1];
  const utf8 = first === 0xef && second === 0xbb && bytes[2] === 0xbf;
  return utf8 || (first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff);
}

function peekMobi(bytes: Buffer, fallback: BookFormat): BookFormat {
  try {
    return mobiFormatOf(bytes);
  } catch (error) {
    // A damaged header is reported by parseBook itself; for detection the file name is the best remaining guess.
    if (error instanceof BookParseError || error instanceof RangeError) {
      return fallback === 'azw3' ? 'azw3' : 'mobi';
    }
    throw error;
  }
}

/** The bytes decide when they can (ZIP + mimetype, BOOKMOBI); otherwise the extension; otherwise a text BOM. */
export function detectBookFormat(fileName: string, bytes: Buffer): BookFormat | null {
  const byExtension = EXTENSION_FORMATS[extensionOf(fileName)] ?? null;
  if (isZip(bytes)) {
    return byExtension === 'epub' || hasEpubMimetype(bytes) ? 'epub' : null;
  }
  if (isPdbBook(bytes)) {
    return peekMobi(bytes, byExtension ?? 'mobi');
  }
  if (byExtension !== null) {
    return byExtension;
  }
  return hasTextBom(bytes) ? 'txt' : null;
}

function runParser(format: BookFormat, bytes: Buffer): DraftBook {
  try {
    if (format === 'epub') {
      return parseEpub(bytes);
    }
    return format === 'txt' ? parseTxt(bytes) : parseMobi(bytes);
  } catch (error) {
    // Anything that is not already a user-facing refusal (an out-of-range read in a truncated file, say) means
    // the file could not be read; the original error stays in `cause` for the logs.
    if (error instanceof BookParseError) {
      throw error;
    }
    throw corrupt(error);
  }
}

/** Cuts blocks into runs of at most CHAPTER_MAX_CHARS; a single longer block stays whole. */
function splitBlocks(blocks: Block[]): Block[][] {
  const parts: Block[][] = [];
  let current: Block[] = [];
  let length = 0;
  for (const block of blocks) {
    const size = blockText(block).length;
    // Blocks without text (an image, a rule) never start a part, so no part is left without text.
    if (size > 0 && current.length > 0 && length + size > CHAPTER_MAX_CHARS) {
      parts.push(current);
      current = [];
      length = 0;
    }
    current.push(block);
    length += size;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

function finish(draft: DraftBook, fileName: string): ParsedBook {
  const kept = draft.chapters.filter((chapter) => renderBlocks(chapter.blocks).text.trim().length > 0);
  if (kept.length === 0) {
    throw new BookParseError('empty', BOOK_MESSAGES.empty);
  }
  const chapters: ParsedChapter[] = [];
  const imageKeys = new Set<string>(draft.coverKey === null ? [] : [draft.coverKey]);
  kept.forEach((chapter, index) => {
    const title = chapter.title ?? `第 ${index + 1} 章`;
    splitBlocks(chapter.blocks).forEach((blocks, part) => {
      chapters.push({ title: part === 0 ? title : `${title}（${part + 1}）`, ...renderBlocks(blocks) });
    });
    for (const key of chapter.imageKeys) {
      imageKeys.add(key);
    }
  });
  const images = [...imageKeys]
    .map((key) => draft.images?.image(key) ?? null)
    .filter((image) => image !== null);
  const cover = draft.coverKey === null ? null : (draft.images?.image(draft.coverKey) ?? null);
  return {
    format: draft.format,
    title: draft.title ?? (stemOf(fileName) || UNTITLED_BOOK),
    author: draft.author,
    language: draft.language,
    cover,
    chapters,
    images,
  };
}

export function parseBook(input: { fileName: string; bytes: Buffer }): ParsedBook {
  const { fileName, bytes } = input;
  if (bytes.length > BOOK_MAX_BYTES) {
    throw new BookParseError('too_large', BOOK_MESSAGES.tooLarge);
  }
  const format = detectBookFormat(fileName, bytes);
  if (format === null) {
    throw new BookParseError('unsupported', BOOK_MESSAGES.unsupportedFormat);
  }
  return finish(runParser(format, bytes), fileName);
}
