// Plain-text novels: decode (BOM, UTF-8, else GB18030), one paragraph per non-empty line, chapters at heading lines
// such as 「第一章」「楔子」「Chapter 3」. Without any heading the text is cut into parts so no chapter is huge.

import { blockText, headingBlock, isEmptyBlock, paragraphBlock } from './blocks.ts';
import type { Block } from './blocks.ts';
import { decodeUtf8Strict, decodeWithBom } from './decode.ts';
import type { DraftBook, DraftChapter } from './draft.ts';

// About a screenful of reading per part when the text has no headings at all (task brief).
export const TXT_PART_CHARS = 8000;
// Headings are short; a long line that happens to start with 「第一次」-like words is prose.
const HEADING_MAX_CHARS = 40;
const PREFACE_TITLE = '开头';

const NUMERAL = '[0-9０-９零一二三四五六七八九十百千万〇两]';
const HEADING_PATTERNS = [
  new RegExp(`^第${NUMERAL}+[章节回卷部篇集幕]`),
  new RegExp(`^(?:序|序言|序章|前言|楔子|引子|引言|尾声|后记|终章|番外)(?:$|[\\s　:：·.、—-]|篇|${NUMERAL}+)`),
  /^(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+)\b/i,
  /^(?:prologue|epilogue|preface|introduction)\b/i,
];

export function decodeText(bytes: Buffer): string {
  return decodeWithBom(bytes) ?? decodeUtf8Strict(bytes) ?? new TextDecoder('gb18030').decode(bytes);
}

function isHeading(line: string): boolean {
  return line.length <= HEADING_MAX_CHARS && HEADING_PATTERNS.some((pattern) => pattern.test(line));
}

function chunkIntoParts(paragraphs: Block[]): DraftChapter[] {
  const parts: DraftChapter[] = [];
  let blocks: Block[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    blocks.push(paragraph);
    length += blockText(paragraph).length;
    if (length >= TXT_PART_CHARS) {
      parts.push({ title: `第 ${parts.length + 1} 部分`, blocks, imageKeys: [] });
      blocks = [];
      length = 0;
    }
  }
  if (blocks.length > 0) {
    parts.push({ title: `第 ${parts.length + 1} 部分`, blocks, imageKeys: [] });
  }
  return parts;
}

export function parseTxt(bytes: Buffer): DraftBook {
  const chapters: DraftChapter[] = [];
  let current: DraftChapter = { title: PREFACE_TITLE, blocks: [], imageKeys: [] };
  let sawHeading = false;
  for (const line of decodeText(bytes).split(/\r\n|\r|\n/)) {
    const paragraph = paragraphBlock(line);
    if (isEmptyBlock(paragraph)) {
      continue;
    }
    const text = blockText(paragraph);
    if (!isHeading(text)) {
      current.blocks.push(paragraph);
      continue;
    }
    sawHeading = true;
    if (current.blocks.length > 0) {
      chapters.push(current);
    }
    current = { title: text, blocks: [headingBlock(text, 2)], imageKeys: [] };
  }
  const book: DraftBook = {
    format: 'txt',
    title: null,
    author: null,
    language: null,
    coverKey: null,
    chapters,
    images: null,
  };
  if (!sawHeading) {
    book.chapters = chunkIntoParts(current.blocks);
    return book;
  }
  if (current.blocks.length > 0) {
    chapters.push(current);
  }
  return book;
}
