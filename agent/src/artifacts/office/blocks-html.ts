import type { Block, Inline } from './markdown-blocks.ts';
import { type ImageData, xmlEscape } from './package-xml.ts';

function inlineHtml(inline: readonly Inline[]): string {
  return inline.map((part) => {
    let html = xmlEscape(part.text);
    if (part.code === true) {
      html = `<code>${html}</code>`;
    }
    if (part.bold === true) {
      html = `<strong>${html}</strong>`;
    }
    if (part.italic === true) {
      html = `<em>${html}</em>`;
    }
    if (part.link !== undefined && /^https?:\/\//i.test(part.link)) {
      html = `<a href="${xmlEscape(part.link)}">${html}</a>`;
    }
    return html;
  }).join('');
}

function tableHtml(head: readonly Inline[][], rows: readonly Inline[][][]): string {
  const header = head.map((cell) => `<th>${inlineHtml(cell)}</th>`).join('');
  const body = rows.map((row) =>
    `<tr>${head.map((_, index) => `<td>${inlineHtml(row[index] ?? [])}</td>`).join('')}</tr>`);
  return `<table><thead><tr>${header}</tr></thead><tbody>${body.join('')}</tbody></table>`;
}

function imageHtml(found: ImageData | null, src: string, alt: string): string {
  if (found === null) {
    return `<p>［图：${xmlEscape(alt === '' ? src : alt)}］</p>`;
  }
  const caption = alt === '' ? '' : `<figcaption>${xmlEscape(alt)}</figcaption>`;
  const data = `data:image/${found.type};base64,${found.data.toString('base64')}`;
  return `<figure><img src="${data}" alt="${xmlEscape(alt)}">${caption}</figure>`;
}

function blockHtml(block: Block, image: (src: string) => ImageData | null): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level}>${inlineHtml(block.inline)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${inlineHtml(block.inline)}</p>`;
    case 'quote':
      return `<blockquote>${inlineHtml(block.inline)}</blockquote>`;
    case 'code':
      return `<pre>${xmlEscape(block.text)}</pre>`;
    case 'rule':
      return '<hr>';
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'table':
      return tableHtml(block.head, block.rows);
    case 'image':
      return imageHtml(image(block.src), block.src, block.alt);
  }
}

const STYLE = [
  '@page { size: A4; margin: 20mm; }',
  'body { font-family: "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif; }',
  'body { font-size: 11pt; line-height: 1.7; color: #1f1d1a; margin: 0; }',
  'h1 { font-size: 20pt; margin: 0 0 12pt; }',
  'h2 { font-size: 15pt; margin: 18pt 0 8pt; }',
  'h3 { font-size: 12.5pt; margin: 14pt 0 6pt; }',
  'p { margin: 0 0 8pt; }',
  'blockquote { margin: 0 0 8pt; padding-left: 12pt; border-left: 2pt solid #d8d3cb; color: #5a534b; }',
  'pre { background: #f1eee8; padding: 8pt; border-radius: 4pt; font-size: 9.5pt; white-space: pre-wrap; }',
  'code { font-family: Menlo, monospace; font-size: 0.92em; }',
  'table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; font-size: 10pt; }',
  'th, td { border: 0.5pt solid #bfb8ae; padding: 4pt 6pt; text-align: left; vertical-align: top; }',
  'th { background: #f1eee8; }',
  'img { max-width: 100%; }',
  'figure { margin: 0 0 10pt; }',
  'figcaption { font-size: 9pt; color: #5a534b; }',
  'hr { border: 0; border-top: 0.5pt solid #bfb8ae; }',
  'a { color: #3a72a3; }',
].join('\n');

export function blocksHtml(blocks: readonly Block[], title: string, image: (src: string) => ImageData | null): string {
  const body = blocks.map((block) => blockHtml(block, image)).join('\n');
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>${xmlEscape(title)}</title>`
    + `<style>\n${STYLE}\n</style></head><body>\n${body}\n</body></html>`;
}
