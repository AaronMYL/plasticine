export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'rule' };

const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*]+)\*)|(_([^_]+)_)/g;

export function inlineOf(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > at) out.push({ text: text.slice(at, index) });
    if (match[2] !== undefined) out.push({ text: match[2], bold: true });
    else if (match[4] !== undefined) out.push({ text: match[4], code: true });
    else if (match[6] !== undefined) out.push({ text: match[6], link: match[7] ?? '' });
    else out.push({ text: match[9] ?? match[11] ?? '', italic: true });
    at = index + match[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function plainOf(inline: readonly Inline[]): string {
  return inline.map((part) => part.text).join('');
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function markdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inline: inlineOf(paragraph.join(' ')) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const image = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (line.trim() === '') {
      flush();
    } else if (line.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (index += 1; index < lines.length && !(lines[index] ?? '').startsWith('```'); index += 1) {
        code.push(lines[index] ?? '');
      }
      blocks.push({ kind: 'code', text: code.join('\n') });
    } else if (heading !== null) {
      flush();
      const level = Math.min(3, heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, inline: inlineOf(heading[2] ?? '') });
    } else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
    } else if (image !== null) {
      flush();
      blocks.push({ kind: 'image', alt: image[1] ?? '', src: image[2] ?? '' });
    } else if (line.trimStart().startsWith('>')) {
      flush();
      const quoted: string[] = [];
      for (; index < lines.length && (lines[index] ?? '').trimStart().startsWith('>'); index += 1) {
        quoted.push((lines[index] ?? '').trimStart().replace(/^>\s?/, ''));
      }
      index -= 1;
      blocks.push({ kind: 'quote', inline: inlineOf(quoted.join(' ')) });
    } else if (line.includes('|') && TABLE_RULE.test(lines[index + 1] ?? '')) {
      flush();
      const head = cells(line).map(inlineOf);
      const rows: Inline[][][] = [];
      for (index += 2; index < lines.length && (lines[index] ?? '').includes('|'); index += 1) {
        rows.push(cells(lines[index] ?? '').map(inlineOf));
      }
      index -= 1;
      blocks.push({ kind: 'table', head, rows });
    } else if (LIST_ITEM.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: Inline[][] = [];
      for (; index < lines.length; index += 1) {
        const item = LIST_ITEM.exec(lines[index] ?? '');
        if (item === null || /^\s*\d/.test(lines[index] ?? '') !== ordered) break;
        items.push(inlineOf(item[3] ?? ''));
      }
      index -= 1;
      blocks.push({ kind: 'list', ordered, items });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
