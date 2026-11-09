// 空间网页片段（第 8 批第 6 条）的读法：按字符扫一遍分成标签和文字（不建真的 DOM，服务端不引 jsdom），再搭一棵够用的
// 小树。清洗（subs/space-sanitize.ts）、全文索引、一期的简报（结论一句、数字条）、找「值得跟进」都从这里读。
// 只认 body 里的片段：script、style 的内容按原样留着，不当文字。

export interface HtmlAttribute {
  /** 原样的大小写（SVG 的 viewBox 要留着）；比较时用小写。 */
  name: string;
  /** 只写了名字（`hidden`）是 null。 */
  value: string | null;
}

export type HtmlToken =
  | { type: 'text'; text: string }
  | { type: 'comment'; text: string }
  | { type: 'start'; name: string; tag: string; attrs: HtmlAttribute[]; selfClosing: boolean; raw: string | null }
  | { type: 'end'; name: string; tag: string };
// name 是小写（比较用），tag 是原样（写回去用：SVG 的 linearGradient 要留着大小写）。

/** 内容按原样读到结束标签为止的元素（里面的 `<` 不是标签）。 */
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

/** 一段片段拆成标签和文字。坏的写法（没闭合的引号、孤零零的 `<`）按文字处理，不抛错。 */
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

// ---------- 一棵够用的小树 ----------

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

/** 按标签搭树：结束标签找最近的同名元素收口，找不到就忽略；空元素不收孩子。 */
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

/** 深度优先找所有满足条件的元素。 */
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

/** 元素里看得见的字：script、style 不算；块级元素之间换行；连续空白收成一个。 */
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

/** 空间网页片段摊成纯文字：全文索引、分身读材料、回顾里引用都用这一份。 */
export function spaceHtmlText(html: string): string {
  return textOf(parseHtml(html));
}
