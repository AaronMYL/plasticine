// 与翻译一样在标签的独立脚本环境中执行；只标已读取的字，不运行网页指令。
export interface ExtractMark { quote: string; context: string }
export type ExtractPageCommand = { kind: 'extract_images' }
  | { kind: 'extract_marks'; points: ExtractMark[]; focus?: number; color?: string };
const MARK_ATTRIBUTE = 'data-plasticine-extract';
const SKIP = 'script,style,noscript,textarea,input,select,[contenteditable="true"],nav,footer,aside';
const MAX_IMAGES = 12;

function normalized(value: string): string { return value.replace(/\s+/g, ' ').trim(); }

function clearMarks(doc: Document): void {
  for (const mark of doc.querySelectorAll(`[${MARK_ATTRIBUTE}]`)) {
    const parent = mark.parentNode;
    mark.replaceWith(...mark.childNodes);
    parent?.normalize();
  }
}

function textMap(root: Element, doc: Document) {
  const walker = doc.createTreeWalker(root, 4);
  const positions: { node: Text; offset: number }[] = [];
  let text = '';
  let next: Node | null;
  while ((next = walker.nextNode()) !== null) {
    const node = next as Text;
    if (node.parentElement?.closest(SKIP) !== null) continue;
    for (let offset = 0; offset < node.data.length; offset += 1) {
      const char = node.data[offset]!;
      if (/\s/.test(char)) {
        if (text === '' || text.endsWith(' ')) continue;
        text += ' ';
      } else text += char;
      positions.push({ node, offset });
    }
  }
  return { text, positions };
}

function markPoint(doc: Document, point: ExtractMark, index: number, color: string): HTMLElement | null {
  const roots = [...doc.querySelectorAll('article p,main p,[role="main"] p,p,li,h1,h2,h3')];
  const quote = normalized(point.quote);
  const context = normalized(point.context);
  for (const root of roots) {
    if (root.closest(SKIP) !== null) continue;
    const mapped = textMap(root, doc);
    if (context !== '' && !mapped.text.includes(context)) continue;
    const start = mapped.text.indexOf(quote);
    if (start < 0) continue;
    const entries = mapped.positions.slice(start, start + quote.length);
    const nodes = new Map<Text, { start: number; end: number }>();
    for (const entry of entries) {
      const previous = nodes.get(entry.node);
      nodes.set(entry.node, { start: previous?.start ?? entry.offset, end: entry.offset + 1 });
    }
    let first: HTMLElement | null = null;
    for (const [node, span] of nodes) {
      const range = doc.createRange();
      range.setStart(node, span.start);
      range.setEnd(node, span.end);
      const mark = doc.createElement('mark');
      mark.setAttribute(MARK_ATTRIBUTE, String(index));
      mark.style.backgroundColor = color;
      mark.style.color = 'inherit';
      range.surroundContents(mark);
      first ??= mark;
    }
    return first;
  }
  return null;
}

export function extractPage(doc: Document, command: ExtractPageCommand): unknown {
  if (command.kind === 'extract_images') {
    const root = doc.querySelector('article,main,[role="main"]') ?? doc.body;
    const paragraphs = [...root.querySelectorAll('p,h1,h2,h3,li')];
    return [...root.querySelectorAll('img')].filter((image) => image.closest(SKIP) === null
      && (image.naturalWidth === 0 || image.naturalWidth >= 80)).flatMap((image) => {
      const raw = image.currentSrc || image.src || image.dataset['src'] || '';
      if (!/^https?:\/\//i.test(raw)) return [];
      const before = paragraphs.filter((paragraph) => Boolean(paragraph.compareDocumentPosition(image) & 4)).at(-1);
      return [{ url: raw, alt: (image.alt ?? '').slice(0, 500),
        afterText: normalized(before?.textContent ?? '').slice(-1000) }];
    }).slice(0, MAX_IMAGES);
  }
  clearMarks(doc);
  let marked = 0;
  for (const [index, point] of command.points.entries()) {
    const mark = markPoint(doc, point, index, command.color ?? 'Mark');
    if (mark === null) continue;
    marked += 1;
    if (command.focus === index) mark.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
  return { marked };
}
