// 空间网页片段的清洗（第 8 批第 6 条，11-09 定）：存之前过一遍，按标签原样重新写出来。
// 显示用的是沙盒 iframe（只给 allow-scripts，不给同源）加一条 CSP（connect-src 'none'，图只认 data: 和 blob:），那是
// 第一道；这里是第二道，也让存下来的东西干净：
// - 连同内容去掉：iframe、frame、object、embed、applet、portal、外链脚本（script src）、title、noscript、template；
// - 去掉标签留内容：form、html、head、body（片段只是 body 里的东西）；base、meta、link 整个不要（含 meta refresh 跳转）；
// - 属性：srcdoc、formaction、action、http-equiv、ping、target 不留；改字时外面加的 contenteditable、data-e 也不留；
//   链接只留 http(s)、mailto、页内锚点和 Plasticine 自己的地址（#/…）；图只留 data:image 和 Plasticine 自己的资产
//   （/v2/notes/assets/…），外链图片（CSP 也载不出来）去掉，并告诉写的人。
// 允许：内联 svg、style、内联小脚本（筛选、目录高亮）和 on* 事件——它们只在沙盒里跑，碰不到 Plasticine。

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
  /** 去掉了什么（「外链脚本 1 处」），回给写的人；没去掉东西是空的。 */
  removed: string[];
}

/** 浏览器解析网址时会忽略控制字符和空白（java\tscript:），查协议前先去掉。 */
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
  // style 里的 @import 会去外面拿东西（CSP 也拦），一并去掉。
  return name === 'style' ? raw.replace(/@import[^;]*;?/gi, '') : raw;
}

/** 清洗一段片段：危险的去掉、其余原样写回。 */
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
