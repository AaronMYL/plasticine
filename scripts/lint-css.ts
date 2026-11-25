/**
 * CSS formatting and comment extraction rules: one declaration per line (single-declaration short rules allowed)
 * and closing braces aligned with their rule opener.
 */

export interface CssComment {
  text: string;
  offset: number;
}

/** Extracts `/* ... *\/` comments from CSS while skipping quoted string literals. */
export function cssComments(source: string): CssComment[] {
  const comments: CssComment[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      comments.push({ text: source.slice(i, stop), offset: i });
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return comments;
}

/** Strips comments, strings, and parenthesized expressions while preserving line numbers. */
export function cssSkeleton(source: string): string {
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += ' '.repeat(Math.min(j + 1, source.length) - i);
      i = j + 1;
    } else {
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1);
      }
      out += depth > 0 && ch !== '\n' && ch !== '(' ? ' ' : ch;
      i += 1;
    }
  }
  return out;
}

/** Counts declarations and opening braces on a single skeleton line. */
export function cssLineLoad(line: string): { declarations: number; blocks: number } {
  const blocks = line.split('{').length - 1;
  let declarations = line.split(';').length - 1;
  const close = line.lastIndexOf('}');
  if (close >= 0) {
    const tail = line.slice(Math.max(line.lastIndexOf(';', close), line.lastIndexOf('{', close)) + 1, close);
    if (tail.includes(':')) {
      declarations += 1;
    }
  }
  return { declarations, blocks };
}

/** Returns 1-based line numbers with multiple declarations, nested blocks, or crowded multi-line braces. */
export function crowdedCssLines(source: string): number[] {
  const found: number[] = [];
  cssSkeleton(source).split('\n').forEach((line, index) => {
    const { declarations, blocks } = cssLineLoad(line);
    const trailing = blocks === 0 && /\S[^}]*\}/.test(line);
    const leading = blocks === 1 && !line.includes('}') && /\{\s*\S/.test(line);
    if (declarations > 1 || blocks > 1 || trailing || leading) {
      found.push(index + 1);
    }
  });
  return found;
}

/** Returns 1-based line numbers where a standalone closing `}` does not match its rule opener's indentation. */
export function misalignedCssBraces(source: string): number[] {
  const found: number[] = [];
  const openers: string[] = [];
  let fresh = true;
  let start = '';
  cssSkeleton(source).split('\n').forEach((line, index) => {
    const text = line.trim();
    if (text === '') {
      return;
    }
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (text === '}') {
      const opener = openers.pop();
      if (opener !== undefined && opener !== indent) {
        found.push(index + 1);
      }
      fresh = true;
      return;
    }
    if (fresh) {
      start = indent;
    }
    for (const ch of text) {
      if (ch === '{') {
        openers.push(start);
      } else if (ch === '}') {
        openers.pop();
      }
    }
    fresh = /[{};]$/.test(text);
  });
  return found;
}
