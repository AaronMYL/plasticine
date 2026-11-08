// 高亮重新对上原文：书换过版本或重新解析后，存下的下标可能偏了。先看下标处还是不是原句；不是就找
// 「前文 + 原句 + 后文」；再不行找离原位置最近的那一处原句；都找不到就不画（列表里照样有，写「原文里没找到这一段」）。

import { BOOK_CONTEXT_CHARS } from '../../api/shared.ts';

export interface StoredAnchor {
  start: number;
  end: number;
  quote: string;
  prefix?: string;
  suffix?: string;
}

export interface TextRange {
  start: number;
  end: number;
}

function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  if (needle === '') {
    return found;
  }
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

function nearest(positions: readonly number[], target: number): number | undefined {
  return positions.reduce<number | undefined>((best, at) =>
    best === undefined || Math.abs(at - target) < Math.abs(best - target) ? at : best, undefined);
}

export function reanchor(text: string, anchor: StoredAnchor): TextRange | null {
  if (anchor.quote === '') {
    return null;
  }
  if (text.slice(anchor.start, anchor.end) === anchor.quote) {
    return { start: anchor.start, end: anchor.end };
  }
  const prefix = anchor.prefix ?? '';
  const suffix = anchor.suffix ?? '';
  if (prefix !== '' || suffix !== '') {
    const withContext = nearest(occurrences(text, `${prefix}${anchor.quote}${suffix}`), anchor.start - prefix.length);
    if (withContext !== undefined) {
      const start = withContext + prefix.length;
      return { start, end: start + anchor.quote.length };
    }
  }
  const bare = nearest(occurrences(text, anchor.quote), anchor.start);
  return bare === undefined ? null : { start: bare, end: bare + anchor.quote.length };
}

/** 新划的一段前后各留一小段原文，换版本后靠它重新对上（服务端上限 BOOK_CONTEXT_CHARS）。 */
export function contextAround(text: string, start: number, end: number): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - BOOK_CONTEXT_CHARS), start),
    suffix: text.slice(end, end + BOOK_CONTEXT_CHARS),
  };
}
