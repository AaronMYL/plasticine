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

export function contextAround(text: string, start: number, end: number): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - BOOK_CONTEXT_CHARS), start),
    suffix: text.slice(end, end + BOOK_CONTEXT_CHARS),
  };
}
