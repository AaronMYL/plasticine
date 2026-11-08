// A small TypeScript/JavaScript tokenizer for lint rules. TypeScript 7 no longer ships a JS parser API,
// and the rules only need to tell code apart from strings, templates, comments and regex literals.

export type TokenKind = 'ident' | 'punct' | 'string' | 'template' | 'comment' | 'number' | 'regex';

export interface Token {
  kind: TokenKind;
  text: string;
  offset: number;
}

// After these, a `/` starts a regex literal rather than a division.
const REGEX_AFTER_PUNCT = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<',
  '>', '~', '^', '=>']);
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'yield', 'await']);
const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const DIGIT = /[0-9]/;
const NUMBER_PART = /[\w.]/;
const WHITESPACE = /\s/;
const REGEX_FLAG = /[a-z]/;

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
    } else if (ch === quote || ch === '\n') {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return i;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf('*/', start + 2);
  return end < 0 ? source.length : end + 2;
}

function skipLineComment(source: string, start: number): number {
  const end = source.indexOf('\n', start);
  return end < 0 ? source.length : end;
}

function skipRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') {
      return i;
    }
    if (ch === '[') {
      inClass = true;
    } else if (ch === ']') {
      inClass = false;
    } else if (ch === '/' && !inClass) {
      i += 1;
      while (i < source.length && REGEX_FLAG.test(source[i] ?? '')) {
        i += 1;
      }
      return i;
    }
    i += 1;
  }
  return i;
}

function startsRegex(previous: Token | undefined): boolean {
  if (!previous) {
    return true;
  }
  if (previous.kind === 'punct') {
    return REGEX_AFTER_PUNCT.has(previous.text);
  }
  return previous.kind === 'ident' && REGEX_AFTER_KEYWORD.has(previous.text);
}

function skipWhile(source: string, start: number, pattern: RegExp): number {
  let i = start;
  while (i < source.length && pattern.test(source[i] ?? '')) {
    i += 1;
  }
  return i;
}

interface Scanned {
  tokens: Token[];
  end: number;
}

/**
 * Reads a template literal. The code inside each `${ … }` is tokenized like any other code (so a `}` inside a
 * string, regex or comment there does not end it) and returned after the template's own token.
 */
function readTemplate(source: string, start: number): Scanned {
  const tokens: Token[] = [];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
    } else if (ch === '`') {
      return { tokens, end: i + 1 };
    } else if (ch === '$' && source[i + 1] === '{') {
      const inner = scanFrom(source, i + 2, true);
      tokens.push(...inner.tokens);
      i = inner.end;
    } else {
      i += 1;
    }
  }
  return { tokens, end: i };
}

/** Tokenizes from `start`; inside a template expression it stops after the `}` that closes it. */
function scanFrom(source: string, start: number, inExpression: boolean): Scanned {
  const tokens: Token[] = [];
  let lastCode: Token | undefined;
  let braces = 0;
  let i = start;
  while (i < source.length) {
    const ch = source[i] ?? '';
    const next = source[i + 1];
    const from = i;
    let kind: TokenKind;
    let inner: Token[] = [];
    if (WHITESPACE.test(ch)) {
      i += 1;
      continue;
    } else if (ch === '/' && next === '/') {
      i = skipLineComment(source, i);
      kind = 'comment';
    } else if (ch === '/' && next === '*') {
      i = skipBlockComment(source, i);
      kind = 'comment';
    } else if (ch === "'" || ch === '"') {
      i = skipQuoted(source, i, ch);
      kind = 'string';
    } else if (ch === '`') {
      const template = readTemplate(source, i);
      i = template.end;
      inner = template.tokens;
      kind = 'template';
    } else if (ch === '/' && startsRegex(lastCode)) {
      i = skipRegex(source, i);
      kind = 'regex';
    } else if (IDENT_START.test(ch)) {
      i = skipWhile(source, i, IDENT_PART);
      kind = 'ident';
    } else if (DIGIT.test(ch)) {
      i = skipWhile(source, i, NUMBER_PART);
      kind = 'number';
    } else {
      if (inExpression && ch === '}' && braces === 0) {
        return { tokens, end: i + 1 };
      }
      braces += ch === '{' ? 1 : ch === '}' ? -1 : 0;
      i += ch === '=' && next === '>' ? 2 : 1;
      kind = 'punct';
    }
    const token: Token = { kind, text: source.slice(from, i), offset: from };
    tokens.push(token, ...inner);
    if (kind !== 'comment') {
      lastCode = token;
    }
  }
  return { tokens, end: i };
}

export function scan(source: string): Token[] {
  return scanFrom(source, 0, false).tokens;
}
