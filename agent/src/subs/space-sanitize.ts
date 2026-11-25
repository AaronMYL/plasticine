import {
  escapeHtmlAttribute,
  tokenizeHtml,
  VOID_ELEMENTS,
  type HtmlAttribute,
  type HtmlToken,
} from '../../shared/space-html.ts';

const DROP_WITH_CONTENT = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
  'fencedframe', 'title', 'noscript', 'noembed', 'noframes', 'template', 'xmp', 'plaintext']);
const DROP_TAG = new Set(['form', 'html', 'head', 'body']);
const DROP_VOID = new Set(['base', 'meta', 'link']);
const DROP_ATTRIBUTES = new Set(['srcdoc', 'formaction', 'action', 'http-equiv', 'ping', 'target',
  'contenteditable', 'data-e']);
const LINK_ATTRIBUTES = new Set(['href', 'xlink:href']);
const SOURCE_ATTRIBUTES = new Set(['src', 'poster', 'srcset', 'background']);
const ASSET_PREFIX = '/v2/notes/assets/';
const DATA_IMAGE = /^data:image\/(png|gif|jpe?g|webp|svg\+xml);/i;

export interface SanitizedHtml {
  html: string;
  removed: string[];
}

function compact(value: string): string {
  return value.replace(/[\u0000- \u007f]/g, '');
}

function linkAllowed(value: string): boolean {
  const url = compact(value);
  if (url === '' || url.startsWith('#')) return true;
  return /^(https?:|mailto:)/i.test(url);
}

function sourceAllowed(value: string): boolean {
  const url = compact(value);
  return url.startsWith(ASSET_PREFIX) || DATA_IMAGE.test(url);
}

class Removed {
  readonly #counts = new Map<string, number>();

  add(what: string): void {
    this.#counts.set(what, (this.#counts.get(what) ?? 0) + 1);
  }

  list(): string[] {
    return [...this.#counts].map(([what, count]) => `${what} ${count} 处`);
  }
}

function keepAttribute(attr: HtmlAttribute, removed: Removed): boolean {
  const name = attr.name.toLowerCase();
  if (DROP_ATTRIBUTES.has(name) || name.startsWith('data-pz-')) {
    if (name !== 'contenteditable' && name !== 'data-e' && !name.startsWith('data-pz-')) removed.add(`属性 ${name}`);
    return false;
  }
  const value = attr.value ?? '';
  if (LINK_ATTRIBUTES.has(name) && !linkAllowed(value)) {
    removed.add('不安全的链接');
    return false;
  }
  if (SOURCE_ATTRIBUTES.has(name) && !sourceAllowed(value)) {
    removed.add('外链图片或媒体（只能用 Plasticine 自己的资产或 data: 图）');
    return false;
  }
  return true;
}

function startTag(token: Extract<HtmlToken, { type: 'start' }>, removed: Removed): string {
  const attrs = token.attrs.filter((attr) => keepAttribute(attr, removed))
    .map((attr) => (attr.value === null ? ` ${attr.name}` : ` ${attr.name}="${escapeHtmlAttribute(attr.value)}"`))
    .join('');
  const close = token.selfClosing && !VOID_ELEMENTS.has(token.name) ? ' /' : '';
  return `<${token.tag}${attrs}${close}>`;
}

function rawContent(name: string, raw: string): string {
  return name === 'style' ? raw.replace(/@import[^;]*;?/gi, '') : raw;
}

export function sanitizeSpaceHtml(html: string): SanitizedHtml {
  const removed = new Removed();
  const out: string[] = [];
  let skipping: { name: string; depth: number } | null = null;
  for (const token of tokenizeHtml(html)) {
    if (skipping !== null) {
      if (token.type === 'start' && token.name === skipping.name && token.raw === null && !token.selfClosing) {
        skipping.depth += 1;
      } else if (token.type === 'end' && token.name === skipping.name) {
        skipping.depth -= 1;
        if (skipping.depth === 0) skipping = null;
      }
      continue;
    }
    if (token.type === 'text') {
      out.push(token.text);
      continue;
    }
    if (token.type === 'comment') {
      continue;
    }
    if (token.type === 'end') {
      if (!DROP_TAG.has(token.name) && !DROP_VOID.has(token.name) && !DROP_WITH_CONTENT.has(token.name)) {
        out.push(`</${token.tag}>`);
      }
      continue;
    }
    const externalScript = token.name === 'script' && token.attrs.some((attr) => attr.name.toLowerCase() === 'src');
    if (DROP_WITH_CONTENT.has(token.name) || externalScript) {
      removed.add(externalScript ? '外链脚本' : `${token.name} 元素`);
      if (token.raw !== null || (!token.selfClosing && !VOID_ELEMENTS.has(token.name))) {
        skipping = { name: token.name, depth: 1 };
      }
      continue;
    }
    if (DROP_VOID.has(token.name)) {
      removed.add(`${token.name} 元素`);
      continue;
    }
    if (DROP_TAG.has(token.name)) {
      if (token.name === 'form') removed.add('表单');
      continue;
    }
    out.push(startTag(token, removed));
    if (token.raw !== null) {
      out.push(rawContent(token.name, token.raw));
    }
  }
  return { html: out.join('').trim(), removed: removed.list() };
}
