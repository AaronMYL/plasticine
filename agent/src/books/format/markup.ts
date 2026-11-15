// A tolerant tokenizer for the XML, XHTML and HTML found inside e-books. It never throws: books are often
// hand-made and slightly broken, and a stray "<" should cost one character, not the chapter.

import { decodeEntities } from './entities.ts';

export { decodeEntities } from './entities.ts';

export interface OpenToken {
  kind: 'open';
  /** Lower-cased, prefix kept ("dc:title", "mbp:pagebreak"). */
  name: string;
  /** Lower-cased names, entity-decoded values; an attribute without a value maps to "". */
  attributes: ReadonlyMap<string, string>;
  selfClosing: boolean;
}

export interface CloseToken {
  kind: 'close';
  name: string;
}

export interface TextToken {
  kind: 'text';
  /** Entity-decoded (CDATA is passed through as written). */
  text: string;
}

export type MarkupToken = OpenToken | CloseToken | TextToken;

// Elements whose content is raw text in HTML; scanning for tags inside them would invent elements from code.
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'xmp']);

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[^\s/>"'=<]/;
const SPACE = /\s/;

class Scanner {
  readonly source: string;
  position = 0;
  readonly tokens: MarkupToken[] = [];
  #text = '';

  constructor(source: string) {
    this.source = source;
  }

  pushText(raw: string, decode: boolean): void {
    this.#text += decode ? decodeEntities(raw) : raw;
  }

  push(token: OpenToken | CloseToken): void {
    this.flushText();
    this.tokens.push(token);
  }

  flushText(): void {
    if (this.#text.length > 0) {
      this.tokens.push({ kind: 'text', text: this.#text });
      this.#text = '';
    }
  }

  /** Moves past `marker`, or to the end when it never comes; returns what was skipped. */
  skipPast(marker: string): string {
    const end = this.source.indexOf(marker, this.position);
    const stop = end === -1 ? this.source.length : end;
    const skipped = this.source.slice(this.position, stop);
    this.position = end === -1 ? this.source.length : end + marker.length;
    return skipped;
  }

  skipSpace(): void {
    while (this.position < this.source.length && SPACE.test(this.source[this.position] ?? '')) {
      this.position += 1;
    }
  }

  readName(): string {
    const start = this.position;
    while (this.position < this.source.length && NAME_CHAR.test(this.source[this.position] ?? '')) {
      this.position += 1;
    }
    return this.source.slice(start, this.position);
  }
}

function readAttributeValue(scanner: Scanner): string {
  const quote = scanner.source[scanner.position];
  if (quote === '"' || quote === "'") {
    scanner.position += 1;
    return decodeEntities(scanner.skipPast(quote));
  }
  const start = scanner.position;
  while (scanner.position < scanner.source.length) {
    const char = scanner.source[scanner.position] ?? '';
    if (SPACE.test(char) || char === '>') {
      break;
    }
    scanner.position += 1;
  }
  // `<img src=a.png/>`: the slash belongs to the tag, not the value.
  let value = scanner.source.slice(start, scanner.position);
  if (value.endsWith('/') && scanner.source[scanner.position] === '>') {
    value = value.slice(0, -1);
    scanner.position -= 1;
  }
  return decodeEntities(value);
}

/** Reads attributes up to the end of the tag; returns whether the tag closed itself with "/>". */
function readAttributes(scanner: Scanner, attributes: Map<string, string>): boolean {
  while (scanner.position < scanner.source.length) {
    scanner.skipSpace();
    const char = scanner.source[scanner.position];
    if (char === '>') {
      scanner.position += 1;
      return false;
    }
    if (char === '/') {
      scanner.position += 1;
      if (scanner.source[scanner.position] === '>') {
        scanner.position += 1;
        return true;
      }
      continue;
    }
    const name = scanner.readName().toLowerCase();
    if (name.length === 0) {
      // A quote or "=" where a name should be: skip the character rather than loop on it.
      scanner.position += 1;
      continue;
    }
    scanner.skipSpace();
    let value = '';
    if (scanner.source[scanner.position] === '=') {
      scanner.position += 1;
      scanner.skipSpace();
      value = readAttributeValue(scanner);
    }
    if (!attributes.has(name)) {
      attributes.set(name, value);
    }
  }
  return false;
}

function readOpenTag(scanner: Scanner): void {
  const name = scanner.readName().toLowerCase();
  const attributes = new Map<string, string>();
  const selfClosing = readAttributes(scanner, attributes);
  scanner.push({ kind: 'open', name, attributes, selfClosing });
  if (!selfClosing && RAW_TEXT_ELEMENTS.has(name)) {
    const closing = new RegExp(`</${name}`, 'gi');
    closing.lastIndex = scanner.position;
    const stop = closing.exec(scanner.source)?.index ?? scanner.source.length;
    scanner.pushText(scanner.source.slice(scanner.position, stop), false);
    scanner.position = stop;
  }
}

/** Handles what follows a "<"; returns false when it is not markup and the "<" is plain text. */
function readMarkup(scanner: Scanner): boolean {
  const { source } = scanner;
  const at = scanner.position;
  if (source.startsWith('<!--', at)) {
    scanner.position = at + 4;
    scanner.skipPast('-->');
    return true;
  }
  if (source.startsWith('<![CDATA[', at)) {
    scanner.position = at + 9;
    scanner.pushText(scanner.skipPast(']]>'), false);
    return true;
  }
  const next = source[at + 1] ?? '';
  if (next === '!' || next === '?') {
    scanner.position = at + 2;
    scanner.skipPast('>');
    return true;
  }
  if (next === '/' && NAME_START.test(source[at + 2] ?? '')) {
    scanner.position = at + 2;
    const name = scanner.readName().toLowerCase();
    scanner.skipPast('>');
    scanner.push({ kind: 'close', name });
    return true;
  }
  if (NAME_START.test(next)) {
    scanner.position = at + 1;
    readOpenTag(scanner);
    return true;
  }
  return false;
}

export function tokenize(source: string): MarkupToken[] {
  const scanner = new Scanner(source);
  while (scanner.position < source.length) {
    const lt = source.indexOf('<', scanner.position);
    if (lt === -1) {
      scanner.pushText(source.slice(scanner.position), true);
      break;
    }
    if (lt > scanner.position) {
      scanner.pushText(source.slice(scanner.position, lt), true);
    }
    scanner.position = lt;
    if (!readMarkup(scanner)) {
      scanner.pushText('<', false);
      scanner.position = lt + 1;
    }
  }
  scanner.flushText();
  return scanner.tokens;
}
