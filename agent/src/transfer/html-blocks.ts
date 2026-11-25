import { attribute, findAll, parseHtml, type HtmlElement, type HtmlNode } from '../../shared/space-html.ts';
import type { Block, Inline } from '../artifacts/index.ts';

const SKIP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'nav', 'head', 'title', 'button', 'input',
  'select', 'textarea', 'iframe', 'object', 'embed', 'canvas', 'video', 'audio', 'form', 'meta', 'link']);
const INLINE = new Set(['a', 'b', 'strong', 'i', 'em', 'code', 'kbd', 'samp', 'span', 'small', 'sup', 'sub', 'u',
  's', 'del', 'ins', 'mark', 'abbr', 'cite', 'q', 'time', 'label', 'font', 'br', 'wbr', 'var', 'dfn', 'bdi', 'bdo']);

type Style = Omit<Inline, 'text'>;

function elements(node: HtmlElement): HtmlElement[] {
  return node.children.filter((child): child is HtmlElement => child.kind === 'element');
}

function hasBlock(element: HtmlElement): boolean {
  return elements(element).some((child) => !SKIP.has(child.name) && (!INLINE.has(child.name) || hasBlock(child)));
}

function inlineOf(node: HtmlNode, style: Style, out: Inline[]): void {
  if (node.kind === 'text') {
    out.push({ text: node.text, ...style });
    return;
  }
  if (SKIP.has(node.name) || node.name === 'img') return;
  if (node.name === 'br') {
    out.push({ text: ' ', ...style });
    return;
  }
  const next: Style = { ...style };
  if (node.name === 'b' || node.name === 'strong') next.bold = true;
  if (node.name === 'i' || node.name === 'em') next.italic = true;
  if (node.name === 'code' || node.name === 'kbd' || node.name === 'samp') next.code = true;
  const href = node.name === 'a' ? attribute(node, 'href') : null;
  if (href !== null && href !== '') next.link = href;
  node.children.forEach((child) => inlineOf(child, next, out));
}

function sameStyle(a: Inline, b: Inline): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.link === b.link;
}

function tidy(parts: readonly Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const part of parts) {
    const text = part.text.replace(/\s+/g, ' ');
    const last = merged.at(-1);
    if (last !== undefined && sameStyle(last, part)) {
      last.text = (last.text + text).replace(/ {2,}/g, ' ');
    } else if (text !== '') {
      merged.push({ ...part, text });
    }
  }
  const first = merged[0];
  if (first !== undefined) first.text = first.text.trimStart();
  const end = merged.at(-1);
  if (end !== undefined) end.text = end.text.trimEnd();
  return merged.filter((part) => part.text !== '');
}

function inlineText(element: HtmlElement): Inline[] {
  const parts: Inline[] = [];
  element.children.forEach((child) => inlineOf(child, {}, parts));
  return tidy(parts);
}

function rawText(node: HtmlNode): string {
  return node.kind === 'text' ? node.text : node.children.map(rawText).join('');
}

function listOf(element: HtmlElement): Block {
  const items: Inline[][] = [];
  const walk = (list: HtmlElement): void => {
    for (const item of elements(list).filter((child) => child.name === 'li')) {
      const own = { ...item, children: item.children.filter((child) => child.kind === 'text'
        || (child.name !== 'ul' && child.name !== 'ol')) };
      const text = inlineText(own);
      if (text.length > 0) items.push(text);
      elements(item).filter((child) => child.name === 'ul' || child.name === 'ol').forEach(walk);
    }
  };
  walk(element);
  return { kind: 'list', ordered: element.name === 'ol', items };
}

function tableOf(element: HtmlElement): Block | null {
  const rows = findAll(element, (child) => child.name === 'tr');
  const cells = (row: HtmlElement): Inline[][] => elements(row)
    .filter((cell) => cell.name === 'td' || cell.name === 'th')
    .map(inlineText);
  const [head, ...rest] = rows;
  if (head === undefined) return null;
  return { kind: 'table', head: cells(head), rows: rest.map(cells) };
}

function imageOf(img: HtmlElement, caption: string): Block | null {
  const src = attribute(img, 'src') ?? '';
  if (src === '') return null;
  const alt = caption !== '' ? caption : attribute(img, 'alt') ?? '';
  return { kind: 'image', src, alt };
}

function blockOf(element: HtmlElement, out: Block[]): void {
  const heading = /^h([1-6])$/.exec(element.name);
  if (heading !== null) {
    const inline = inlineText(element);
    if (inline.length > 0) out.push({ kind: 'heading', level: Math.min(3, Number(heading[1])) as 1 | 2 | 3, inline });
    return;
  }
  switch (element.name) {
    case 'ul':
    case 'ol': {
      const list = listOf(element);
      if (list.kind === 'list' && list.items.length > 0) out.push(list);
      return;
    }
    case 'table': {
      const table = tableOf(element);
      if (table !== null) out.push(table);
      return;
    }
    case 'blockquote': {
      const parts: Inline[] = [];
      element.children.forEach((child) => inlineOf(child, {}, parts));
      const inline = tidy(parts);
      if (inline.length > 0) out.push({ kind: 'quote', inline });
      return;
    }
    case 'pre':
      out.push({ kind: 'code', text: rawText(element).replace(/^\n/, '').replace(/\s+$/, '') });
      return;
    case 'hr':
      out.push({ kind: 'rule' });
      return;
    case 'img': {
      const image = imageOf(element, '');
      if (image !== null) out.push(image);
      return;
    }
    case 'figure': {
      const img = findAll(element, (child) => child.name === 'img')[0];
      const caption = findAll(element, (child) => child.name === 'figcaption')[0];
      const image = img === undefined ? null : imageOf(img, caption === undefined ? '' : rawText(caption).trim());
      if (image !== null) out.push(image);
      else blocksOf(element, out);
      return;
    }
    default:
      blocksOf(element, out);
  }
}

function blocksOf(element: HtmlElement, out: Block[]): void {
  let run: Inline[] = [];
  const flush = (): void => {
    const inline = tidy(run);
    if (inline.length > 0) out.push({ kind: 'paragraph', inline });
    run = [];
  };
  for (const child of element.children) {
    if (child.kind === 'text') {
      run.push({ text: child.text });
    } else if (SKIP.has(child.name)) {
      continue;
    } else if (INLINE.has(child.name) && !hasBlock(child)) {
      inlineOf(child, {}, run);
    } else {
      flush();
      blockOf(child, out);
    }
  }
  flush();
}

export function htmlBlocks(html: string): Block[] {
  const root = parseHtml(html);
  const body = findAll(root, (element) => element.name === 'body')[0] ?? root;
  const out: Block[] = [];
  blocksOf(body, out);
  return out;
}
