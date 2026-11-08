// 邮件 HTML 的白名单清洗（用户 2026-11-04 定：邮件按原样显示）。入库前清一次（存 body_html），显示前再过一次（把 cid: 换成
// data:、远程图换成服务端代理地址）。只认白名单里的标签和属性，原样重新写出来：
// - 连同内容去掉：script、iframe、object、embed、svg、math、noscript、template、title、textarea、select 这些；
// - 去掉标签留文字：表单、html / head / body、Outlook 的 o:p、不认识的标签；meta（含 refresh）、link、base 不留；
// - 属性：on* 一个都不留；链接只留 http(s)、mailto、tel 和页内锚点，并加上新窗口和 noopener；图片地址过换图回调；
//   srcset 不留（会绕过代理）；内联样式和 <style> 留着，经 mail-css.ts 去掉会带东西进来的写法。
// 显示用的 iframe 是 sandbox（不给 allow-scripts）加 CSP，这里是第二道。
//
// 为什么不用 DOMPurify / sanitize-html：前者要一份 DOM（服务端得再引 jsdom），后者拖着 htmlparser2 等六个依赖；邮件只要
// 一张固定白名单、按字符扫一遍，不需要真的建树。

import { sanitizeStyleAttribute, sanitizeStyleSheet, type ImageResolver } from './mail-css.ts';
import { decodeEntities } from './mail-html-text.ts';

export type { ImageResolver } from './mail-css.ts';

export interface SanitizeOptions {
  /** 图片地址（img src、background 属性、CSS url()）换成什么；null 去掉。默认 keepImageUrl。 */
  image?: ImageResolver;
}

// 入库时允许的内嵌 data: 图（单张）：邮件里偶有直接写在 HTML 里的小图标；大的多半是整张截图，交给 cid 分段。
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
// 连同内容一起去掉的元素（读到对应的结束标签为止）。
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

/** 入库时的默认换图：cid:、http(s) 和不太大的 data:image 原样留着（显示时再换），别的去掉。 */
export function keepImageUrl(url: string): string | null {
  if (/^cid:/i.test(url) || /^https?:\/\//i.test(url)) {
    return url;
  }
  return DATA_IMAGE.test(url) && url.length <= DATA_IMAGE_MAX_CHARS ? url : null;
}

/** 浏览器解析网址时会忽略控制字符和空白（java\tscript:），查协议前先去掉。 */
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
  /** 标签结束（>）之后的位置；-1 = 没收尾。 */
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

/** 从 `<名字` 之后读属性，读到 `>`；按字符走一遍，引号里的 > 不算。 */
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

/** `</名字` 的位置（不分大小写）；没有就是 -1。 */
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

/** 清洗一段邮件 HTML，回清洗后的片段（没有 html / head / body）。 */
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
      // 没收尾的标签：后面的全不要（浏览器也会把它吞掉）。
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
