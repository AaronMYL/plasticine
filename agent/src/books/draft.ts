// What each format parser hands to parse.ts: chapters still as blocks, so empty chapters can be dropped, long ones
// split at block boundaries, and only images of kept chapters exported, all in one place for every format.

import type { Block } from './blocks.ts';
import type { ImageCollector } from './images.ts';

export type BookFormat = 'epub' | 'txt' | 'mobi' | 'azw3';

export interface DraftChapter {
  /** From the table of contents or the first heading; null lets parse.ts number it. */
  title: string | null;
  blocks: Block[];
  imageKeys: string[];
}

export interface DraftBook {
  format: BookFormat;
  title: string | null;
  author: string | null;
  language: string | null;
  coverKey: string | null;
  chapters: DraftChapter[];
  images: ImageCollector | null;
}

/** Collapses whitespace in metadata; empty becomes null. */
export function cleanMetadata(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/[\s ]+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Several authors are joined the Chinese way; duplicates (common in EXTH) are dropped. */
export function joinAuthors(values: Array<string | null | undefined>): string | null {
  const names = [...new Set(values.map(cleanMetadata).filter((name) => name !== null))];
  return names.length > 0 ? names.join('、') : null;
}
