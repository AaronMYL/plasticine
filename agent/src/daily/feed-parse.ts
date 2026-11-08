// 最小 RSS / Atom XML 读取器：不展开外部实体、不执行 HTML，原文只作选材材料。
import { DailyError } from './errors.ts';
import { cleanUrl } from './urls.ts';

const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_DEPTH = 40;
const MAX_NODES = 50_000;
// XHTML 单元格、定义项和块级容器各自成段；行内标签仍按原文连续拼接。
const TEXT_BOUNDARIES = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search', 'section', 'summary', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
interface XmlNode { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] }

function malformed(): never {
  throw new DailyError('invalid_input', '订阅内容格式不完整，请检查订阅地址后再试。');
}

export function xmlText(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (!entity.startsWith('#')) {
      return named[entity] ?? whole;
    }
    const number = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
}

export function tagAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[(match[1] ?? '').toLowerCase()] = xmlText(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

export function xml(source: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    malformed();
  }
  const root: XmlNode = { name: '', attrs: {}, children: [] };
  const stack = [root];
  let position = 0;
  let nodes = 0;
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g;
  for (const token of source.matchAll(tokens)) {
    if (token.index !== position) {
      malformed();
    }
    const text = token[0];
    position += text.length;
    const parent = stack.at(-1);
    if (parent === undefined) {
      malformed();
    }
    if (text.startsWith('<?') || text.startsWith('<!--')) {
      continue;
    }
    if (text.startsWith('<![CDATA[')) {
      parent.children.push(text.slice(9, -3));
    } else if (text.startsWith('</')) {
      const name = text.slice(2, -1).trim();
      if (stack.length === 1 || name !== parent.name) {
        malformed();
      }
      stack.pop();
    } else if (text.startsWith('<')) {
      const name = /^<([\w:.-]+)/.exec(text)?.[1];
      if (name === undefined || ++nodes > MAX_NODES || stack.length > MAX_DEPTH) {
        malformed();
      }
      const child: XmlNode = { name, attrs: tagAttributes(text), children: [] };
      parent.children.push(child);
      if (!text.endsWith('/>')) {
        stack.push(child);
      }
    } else {
      parent.children.push(xmlText(text));
    }
  }
  const roots = elements(root);
  if (position !== source.length || stack.length !== 1 || roots.length !== 1) {
    malformed();
  }
  return roots[0] as XmlNode;
}

export function local(node: XmlNode): string { return node.name.split(':').at(-1)?.toLowerCase() ?? ''; }
export function elements(node: XmlNode): XmlNode[] {
  return node.children.filter((entry) => typeof entry !== 'string');
}
export function child(node: XmlNode, name: string): XmlNode | undefined {
  return elements(node).find((entry) => local(entry) === name);
}
export function content(node: XmlNode | string | undefined): string {
  if (node === undefined) { return ''; }
  if (typeof node === 'string') { return node; }
  const text = node.children.map(content).join('');
  return TEXT_BOUNDARIES.has(local(node)) ? ` ${text} ` : text;
}
export function plain(text: string): string {
  return xmlText(text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

export interface ParsedFeedItem {
  title: string;
  url: string;
  text: string;
  publishedAt: string;
  /** 第 3 批瀑布流的配图：附件、media:content / thumbnail，或正文里第一张图；只要 https 的。 */
  image: string | null;
  author: string | null;
}

const IMAGE_FILE = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i;

function httpsImage(raw: string | undefined, base: string): string | null {
  if (raw === undefined || raw.trim() === '') { return null; }
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === 'https:' ? url.href : null;
  } catch (error) {
    if (error instanceof TypeError) { return null; }
    throw error;
  }
}

/** 一条里的配图：先认明说是图片的附件和 media 元素，再从正文 HTML 里找第一张 <img>。 */
function imageOf(entry: XmlNode, html: string, base: string): string | null {
  for (const node of elements(entry)) {
    const name = local(node);
    const type = (node.attrs['type'] ?? '').toLowerCase();
    const link = node.attrs['url'] ?? node.attrs['href'];
    const enclosure = name === 'enclosure' || (name === 'link' && node.attrs['rel'] === 'enclosure');
    const media = name === 'content' && node.name.includes(':')
      && (node.attrs['medium'] === 'image' || type.startsWith('image/') || IMAGE_FILE.test(link ?? ''));
    if ((enclosure && type.startsWith('image/')) || media || (name === 'thumbnail' && node.name.includes(':'))) {
      const found = httpsImage(link, base);
      if (found !== null) { return found; }
    }
    if (name === 'group' && node.name.includes(':')) {
      const nested = imageOf(node, '', base);
      if (nested !== null) { return nested; }
    }
  }
  const tag = /<img\b[^>]*>/i.exec(html);
  return tag === null ? null : httpsImage(tagAttributes(tag[0])['src'], base);
}

function authorOf(entry: XmlNode): string | null {
  const node = child(entry, 'author') ?? child(entry, 'creator');
  if (node === undefined) { return null; }
  const name = child(node, 'name');
  const text = plain(content(name ?? node)).slice(0, 200);
  return text === '' ? null : text;
}

/** 订阅源自己的名字（RSS 的 channel/title、Atom 的 feed/title）；加订阅时没给名字就用它。 */
export function feedTitle(source: string): string | null {
  const root = xml(source);
  const channel = local(root) === 'feed' ? root : child(root, 'channel');
  const title = channel === undefined ? '' : plain(content(child(channel, 'title'))).slice(0, 200);
  return title === '' ? null : title;
}

function absolute(raw: string, base: string): string {
  try {
    return new URL(raw, base).href;
  } catch {
    return malformed();
  }
}

/** windowMs：只要这么近的条目（默认两天；Reddit「本周最佳」要放宽到一周多）。 */
export function parseFeed(source: string, base: string, now: Date, windowMs: number = WINDOW_MS): ParsedFeedItem[] {
  const root = xml(source);
  const atom = local(root) === 'feed';
  const channel = atom ? root : child(root, 'channel');
  if (channel === undefined || (!atom && local(root) !== 'rss')) {
    malformed();
  }
  const rootBase = absolute(root.attrs['xml:base'] ?? base, base);
  const channelBase = atom ? rootBase : absolute(channel.attrs['xml:base'] ?? rootBase, rootBase);
  const items: ParsedFeedItem[] = [];
  for (const entry of elements(channel).filter((node) => local(node) === (atom ? 'entry' : 'item'))) {
    const at = Date.parse(content(child(entry, atom ? 'published' : 'pubdate'))
      || content(child(entry, 'updated')) || content(child(entry, 'date')));
    if (!Number.isFinite(at) || at < now.getTime() - windowMs || at > now.getTime()) {
      continue;
    }
    const linkNode = atom ? elements(entry).find((node) => local(node) === 'link'
      && (node.attrs['rel'] ?? 'alternate') === 'alternate') : child(entry, 'link');
    const link = atom ? linkNode?.attrs['href'] : content(linkNode);
    if (!link) {
      continue;
    }
    const entryBase = absolute(entry.attrs['xml:base'] ?? channelBase, channelBase);
    const linkBase = absolute(linkNode?.attrs['xml:base'] ?? entryBase, entryBase);
    const url = cleanUrl(absolute(link, linkBase));
    const body = content(child(entry, 'description') ?? child(entry, 'summary')
      ?? child(entry, 'content') ?? child(entry, 'encoded'));
    const rich = content(child(entry, 'encoded') ?? child(entry, 'content')) || body;
    items.push({ title: plain(content(child(entry, 'title'))).slice(0, 1_000) || '（没有标题）', url,
      text: plain(body).slice(0, 12_000),
      publishedAt: new Date(at).toISOString(), image: imageOf(entry, rich, linkBase), author: authorOf(entry) });
  }
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
