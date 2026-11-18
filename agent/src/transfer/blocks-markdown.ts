// 块写成 Markdown（空间导出成 Markdown 用）：标题、段落、列表、表格、引用、代码、图、分隔线；行内的粗体、斜体、代码、
// 链接。图的地址由调用的一方换（打包时换成 assets/ 下的相对路径）。

import type { Block, Inline } from '../artifacts/index.ts';

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function inlineMarkdown(parts: readonly Inline[]): string {
  return parts.map((part) => {
    let text = part.code === true ? codeSpan(part.text) : escapeText(part.text);
    if (part.bold === true) text = `**${text}**`;
    if (part.italic === true) text = `*${text}*`;
    if (part.link !== undefined) text = `[${text}](${part.link.replace(/[()\s]/g, encodeURIComponent)})`;
    return text;
  }).join('');
}

function cell(parts: readonly Inline[]): string {
  return inlineMarkdown(parts).replace(/\|/g, '\\|');
}

function blockMarkdown(block: Block, image: (src: string) => string): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${inlineMarkdown(block.inline)}`;
    case 'paragraph':
      return inlineMarkdown(block.inline);
    case 'quote':
      return `> ${inlineMarkdown(block.inline)}`;
    case 'code': {
      const fence = /^```/m.test(block.text) ? '~~~' : '```';
      return `${fence}\n${block.text}\n${fence}`;
    }
    case 'rule':
      return '---';
    case 'list':
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${inlineMarkdown(item)}`)
        .join('\n');
    case 'table': {
      const width = block.head.length;
      const row = (cells: readonly Inline[][]): string =>
        `| ${Array.from({ length: width }, (_, index) => cell(cells[index] ?? [])).join(' | ')} |`;
      return [row(block.head), `|${' --- |'.repeat(width)}`, ...block.rows.map(row)].join('\n');
    }
    case 'image':
      return `![${escapeText(block.alt)}](${image(block.src).replace(/[()\s]/g, encodeURIComponent)})`;
  }
}

export function blocksMarkdown(blocks: readonly Block[], image: (src: string) => string = (src) => src): string {
  return `${blocks.map((block) => blockMarkdown(block, image)).filter((text) => text !== '').join('\n\n')}\n`;
}
