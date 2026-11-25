import { sanitizeStyleAttribute, sanitizeStyleSheet, type ImageResolver } from './mail-css.ts';
import { decodeEntities } from './mail-html-text.ts';

export type { ImageResolver } from './mail-css.ts';

export interface SanitizeOptions {
  image?: ImageResolver;
}

const DATA_IMAGE_MAX_CHARS = 512 * 1024;
const DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|bmp);base64,[A-Za-z0-9+/=\s]*$/i;
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col', 'wbr']);
const ALLOWED_TAGS = new Set(['a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'big', 'blockquote',
  'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em', 'figcaption', 'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img',
  'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span',
  'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt',
  'u', 'ul', 'var', 'wbr']);
const DROPPED_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'applet', 'svg', 'math', 'noscript',
  'noembed', 'noframes', 'template', 'title', 'textarea', 'select', 'xmp', 'frameset', 'plaintext', 'button']);
const GLOBAL_ATTRIBUTES = new Set(['style', 'class', 'id', 'dir', 'lang', 'title', 'align', 'valign', 'width',
  'height', 'bgcolor', 'color', 'border', 'role', 'aria-label', 'aria-hidden']);
const TAG_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'name'],
  img: ['src', 'alt', 'hspace', 'vspace'],
  table: ['cellpadding', 'cellspacing', 'background', 'summary', 'frame', 'rules'],
  td: ['colspan', 'rowspan', 'background', 'nowrap', 'headers', 'scope', 'abbr'],
  th: ['colspan', 'rowspan', 'background', 'nowrap', 'headers', 'scope', 'abbr'],
  tr: ['background'],
  tbody: ['background'],
  thead: ['background'],
  tfoot: ['background'],
  col: ['span'],
  colgroup: ['span'],
  font: ['face', 'size'],
  ol: ['start', 'type', 'reversed'],
  ul: ['type'],
  li: ['value', 'type'],
  hr: ['noshade', 'size'],
  del: ['datetime'],
  ins: ['datetime'],
  time: ['datetime'],
  details: ['open'],
};
const IMAGE_ATTRIBUTES = new Set(['src', 'background']);
const TAG_NAME = /[A-Za-z][A-Za-z0-9:-]*/y;
const END_TAG = /<\/([A-Za-z][A-Za-z0-9:-]*)[^>]*>/y;

export function keepImageUrl(url: string): string | null {
  if (/^cid:/i.test(url) || /^https?:\/\//i.test(url)) {
    return url;
  }
  return DATA_IMAGE.test(url) && url.length <= DATA_IMAGE_MAX_CHARS ? url : null;
}

function compactUrl(value: string): string {
  const compact = value.replace(/[\u0000- \u007f]/g, '');
  return compact.startsWith('//') ? `https:${compact}` : compact;
}

function linkTarget(value: string): string | null {
  const url = compactUrl(value);
  if (url.startsWith('#')) {
    return url;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  return scheme !== undefined && LINK_SCHEMES.has(scheme) ? url : null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface RawTag {
  name: string;
  attributes: Array<[string, string | null]>;
  end: number;
}

function skipSpaces(html: string, at: number): number {
  let position = at;
  while (position < html.length && /[\s/]/.test(html[position] ?? '')) {
    position += 1;
  }
  return position;
}

function readValue(html: string, at: number): { value: string; end: number } {
  const quote = html[at];
  if (quote === '"' || quote === "'") {
    const close = html.indexOf(quote, at + 1);
    return close < 0 ? { value: '', end: -1 } : { value: html.slice(at + 1, close), end: close + 1 };
  }
  let position = at;
  while (position < html.length && !/[\s>]/.test(html[position] ?? '')) {
    position += 1;
  }
  return { value: html.slice(at, position), end: position };
}

function readTag(html: string, start: number): RawTag | null {
  TAG_NAME.lastIndex = start + 1;
  const name = TAG_NAME.exec(html)?.[0];
  if (name === undefined) {
    return null;
  }
  const attributes: Array<[string, string | null]> = [];
  let position = start + 1 + name.length;
  for (;;) {
    position = skipSpaces(html, position);
    if (position >= html.length) {
      return { name: name.toLowerCase(), attributes, end: -1 };
    }
    if (html[position] === '>') {
      return { name: name.toLowerCase(), attributes, end: position + 1 };
    }
    const nameStart = position;
    while (position < html.length && !/[\s/>=]/.test(html[position] ?? '')) {
      position += 1;
    }
    const attribute = html.slice(nameStart, position).toLowerCase();
    position = skipSpaces(html, position);
    if (html[position] !== '=') {
      attributes.push([attribute, null]);
      continue;
    }
    position = skipSpaces(html, position + 1);
    const read = readValue(html, position);
    if (read.end < 0) {
      return { name: name.toLowerCase(), attributes, end: -1 };
    }
    attributes.push([attribute, read.value]);
    position = read.end;
  }
}

function cleanAttributes(tag: RawTag, image: ImageResolver): string {
  const allowed = TAG_ATTRIBUTES[tag.name] ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  let link = false;
  for (const [name, raw] of tag.attributes) {
    if (seen.has(name) || (!GLOBAL_ATTRIBUTES.has(name) && !allowed.includes(name))) {
      continue;
    }
    seen.add(name);
    const value = raw === null ? null : decodeEntities(raw);
    let kept: string | null = value;
    if (value !== null && name === 'style') {
      kept = sanitizeStyleAttribute(value, image);
    } else if (value !== null && name === 'href') {
      kept = linkTarget(value);
      link = kept !== null && !kept.startsWith('#');
    } else if (value !== null && IMAGE_ATTRIBUTES.has(name)) {
      kept = image(compactUrl(value));
    }
    if (kept === null && value !== null) {
      continue;
    }
    out.push(kept === null ? ` ${name}` : ` ${name}="${escapeAttribute(kept)}"`);
  }
  if (link) {
    out.push(' target="_blank" rel="noopener noreferrer"');
  }
  return out.join('');
}

function closingTag(html: string, name: string, from: number): { start: number; end: number } {
  const pattern = new RegExp(`</${name}\\b[^>]*>`, 'gi');
  pattern.lastIndex = from;
  const match = pattern.exec(html);
  return match === null ? { start: -1, end: -1 } : { start: match.index, end: match.index + match[0].length };
}

function skipMarkup(html: string, at: number): number {
  if (html.startsWith('<!--', at)) {
    const close = html.indexOf('-->', at + 4);
    return close < 0 ? html.length : close + 3;
  }
  const close = html.indexOf('>', at);
  return close < 0 ? html.length : close + 1;
}

export function sanitizeMailHtml(html: string, options: SanitizeOptions = {}): string {
  const image = options.image ?? keepImageUrl;
  const out: string[] = [];
  let position = 0;
  while (position < html.length) {
    const open = html.indexOf('<', position);
    if (open < 0) {
      out.push(html.slice(position));
      break;
    }
    out.push(html.slice(position, open));
    const next = html[open + 1] ?? '';
    if (next === '!' || next === '?') {
      position = skipMarkup(html, open);
      continue;
    }
    if (next === '/') {
      END_TAG.lastIndex = open;
      const end = END_TAG.exec(html);
      if (end === null) {
        out.push('&lt;');
        position = open + 1;
        continue;
      }
      const name = (end[1] ?? '').toLowerCase();
      if (ALLOWED_TAGS.has(name) && !VOID_TAGS.has(name)) {
        out.push(`</${name}>`);
      }
      position = open + end[0].length;
      continue;
    }
    const tag = readTag(html, open);
    if (tag === null) {
      out.push('&lt;');
      position = open + 1;
      continue;
    }
    if (tag.end < 0) {
      break;
    }
    position = tag.end;
    if (tag.name === 'style') {
      const close = closingTag(html, 'style', position);
      const css = html.slice(position, close.start < 0 ? html.length : close.start);
      out.push(`<style>${sanitizeStyleSheet(css, image)}</style>`);
      position = close.start < 0 ? html.length : close.end;
    } else if (DROPPED_WITH_CONTENT.has(tag.name)) {
      const close = closingTag(html, tag.name, position);
      position = close.start < 0 ? html.length : close.end;
    } else if (ALLOWED_TAGS.has(tag.name)) {
      out.push(`<${tag.name}${cleanAttributes(tag, image)}>`);
    }
  }
  return out.join('');
}
