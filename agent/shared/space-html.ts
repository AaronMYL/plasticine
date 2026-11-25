export interface HtmlAttribute {
  name: string;
  value: string | null;
}

export type HtmlToken =
  | { type: 'text'; text: string }
  | { type: 'comment'; text: string }
  | { type: 'start'; name: string; tag: string; attrs: HtmlAttribute[]; selfClosing: boolean; raw: string | null }
  | { type: 'end'; name: string; tag: string };

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes',
  'noscript', 'plaintext']);
export const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'source', 'track', 'wbr']);
const TAG_NAME = /^[A-Za-z][A-Za-z0-9:-]*/;
const ATTRIBUTE_NAME = /^[^\s"'>/=]+/;

function readAttributes(text: string, from: number): { attrs: HtmlAttribute[]; end: number; selfClosing: boolean } {
  const attrs: HtmlAttribute[] = [];
  let at = from;
  while (at < text.length) {
    while (at < text.length && /\s/.test(text[at] ?? '')) at += 1;
    const char = text[at];
    if (char === undefined) break;
    if (char === '>') return { attrs, end: at + 1, selfClosing: false };
    if (char === '/' && text[at + 1] === '>') return { attrs, end: at + 2, selfClosing: true };
    if (char === '/') {
      at += 1;
      continue;
    }
    const name = ATTRIBUTE_NAME.exec(text.slice(at, at + 200))?.[0];
    if (name === undefined) {
      at += 1;
      continue;
    }
    at += name.length;
    while (at < text.length && /\s/.test(text[at] ?? '')) at += 1;
    if (text[at] !== '=') {
      attrs.push({ name, value: null });
      continue;
    }
    at += 1;
    while (at < text.length && /\s/.test(text[at] ?? '')) at += 1;
    const quote = text[at];
    let value: string;
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, at + 1);
      const stop = close === -1 ? text.length : close;
      value = text.slice(at + 1, stop);
      at = stop + 1;
    } else {
      const match = /^[^\s>]*/.exec(text.slice(at))?.[0] ?? '';
      value = match;
      at += match.length;
    }
    attrs.push({ name, value: decodeEntities(value) });
  }
  return { attrs, end: text.length, selfClosing: false };
}

export function tokenizeHtml(text: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let at = 0;
  let textStart = 0;
  const flushText = (until: number): void => {
    if (until > textStart) tokens.push({ type: 'text', text: text.slice(textStart, until) });
  };
  while (at < text.length) {
    const open = text.indexOf('<', at);
    if (open === -1) break;
    if (text.startsWith('<!--', open)) {
      flushText(open);
      const close = text.indexOf('-->', open + 4);
      const end = close === -1 ? text.length : close + 3;
      tokens.push({ type: 'comment', text: text.slice(open + 4, close === -1 ? text.length : close) });
      at = end;
      textStart = end;
      continue;
    }
    if (text[open + 1] === '!' || text[open + 1] === '?') {
      flushText(open);
      const close = text.indexOf('>', open);
      at = close === -1 ? text.length : close + 1;
      textStart = at;
      continue;
    }
    if (text[open + 1] === '/') {
      const name = TAG_NAME.exec(text.slice(open + 2, open + 80))?.[0];
      if (name === undefined) {
        at = open + 1;
        continue;
      }
      flushText(open);
      const close = text.indexOf('>', open);
      tokens.push({ type: 'end', name: name.toLowerCase(), tag: name });
      at = close === -1 ? text.length : close + 1;
      textStart = at;
      continue;
    }
    const name = TAG_NAME.exec(text.slice(open + 1, open + 80))?.[0];
    if (name === undefined) {
      at = open + 1;
      continue;
    }
    flushText(open);
    const lower = name.toLowerCase();
    const { attrs, end, selfClosing } = readAttributes(text, open + 1 + name.length);
    let raw: string | null = null;
    at = end;
    if (RAW_TEXT.has(lower) && !selfClosing) {
      const closing = new RegExp(`</${lower}[\\s/>]`, 'i');
      const rest = text.slice(end);
      const match = closing.exec(rest);
      raw = match === null ? rest : rest.slice(0, match.index);
      at = match === null ? text.length : end + match.index;
    }
    tokens.push({ type: 'start', name: lower, tag: name, attrs, selfClosing, raw });
    if (raw !== null) {
      const close = text.indexOf('>', at);
      if (at < text.length) {
        tokens.push({ type: 'end', name: lower, tag: name });
      }
      at = close === -1 ? text.length : close + 1;
    }
    textStart = at;
  }
  flushText(text.length);
  return tokens;
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', times: '×', minus: '−', ldquo: '“', rdquo: '”', lsquo: '‘',
  rsquo: '’', plusmn: '±', le: '≤', ge: '≥', rarr: '→', larr: '←' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeHtmlAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export interface HtmlElement {
  kind: 'element';
  name: string;
  attrs: HtmlAttribute[];
  children: HtmlNode[];
  raw: string | null;
}
export type HtmlNode = HtmlElement | { kind: 'text'; text: string };

export function attribute(element: HtmlElement, name: string): string | null {
  return element.attrs.find((attr) => attr.name.toLowerCase() === name)?.value ?? null;
}

export function hasAttribute(element: HtmlElement, name: string): boolean {
  return element.attrs.some((attr) => attr.name.toLowerCase() === name);
}

export function hasClass(element: HtmlElement, name: string): boolean {
  return (attribute(element, 'class') ?? '').split(/\s+/).includes(name);
}

export function parseHtml(text: string): HtmlElement {
  const root: HtmlElement = { kind: 'element', name: '#root', attrs: [], children: [], raw: null };
  const stack: HtmlElement[] = [root];
  for (const token of tokenizeHtml(text)) {
    const top = stack[stack.length - 1] ?? root;
    if (token.type === 'text') {
      top.children.push({ kind: 'text', text: decodeEntities(token.text) });
    } else if (token.type === 'start') {
      const element: HtmlElement = { kind: 'element', name: token.name, attrs: token.attrs, children: [],
        raw: token.raw };
      top.children.push(element);
      if (!token.selfClosing && !VOID_ELEMENTS.has(token.name)) {
        stack.push(element);
      }
    } else if (token.type === 'end') {
      const index = stack.map((item) => item.name).lastIndexOf(token.name);
      if (index > 0) {
        stack.length = index;
      }
    }
  }
  return root;
}

export function findAll(root: HtmlElement, match: (element: HtmlElement) => boolean): HtmlElement[] {
  const found: HtmlElement[] = [];
  const walk = (element: HtmlElement): void => {
    for (const child of element.children) {
      if (child.kind === 'element') {
        if (match(child)) found.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main', 'li', 'tr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'figcaption', 'blockquote', 'dt', 'dd', 'table', 'ul', 'ol', 'br']);
const SILENT = new Set(['script', 'style', 'template', 'noscript']);

export function textOf(node: HtmlNode): string {
  const parts: string[] = [];
  const walk = (current: HtmlNode): void => {
    if (current.kind === 'text') {
      parts.push(current.text);
      return;
    }
    if (SILENT.has(current.name)) return;
    const block = BLOCKS.has(current.name);
    if (block) parts.push('\n');
    current.children.forEach(walk);
    if (block) parts.push('\n');
  };
  walk(node);
  return parts.join('').replace(/[ \t ]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim();
}

export function spaceHtmlText(html: string): string {
  return textOf(parseHtml(html));
}
