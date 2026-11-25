import type { Block, Inline } from '../artifacts/index.ts';
import { escapeHtmlAttribute, escapeHtmlText } from '../../shared/space-html.ts';

const LOCAL_IMAGE = /^(\/v2\/notes\/assets\/|data:image\/(png|gif|jpe?g|webp);)/i;
const SAFE_LINK = /^(https?:|mailto:|#)/i;

function inlineHtml(parts: readonly Inline[]): string {
  return parts.map((part) => {
    let html = escapeHtmlText(part.text);
    if (part.code === true) html = `<code>${html}</code>`;
    if (part.bold === true) html = `<strong>${html}</strong>`;
    if (part.italic === true) html = `<em>${html}</em>`;
    if (part.link !== undefined && SAFE_LINK.test(part.link.trim())) {
      html = `<a href="${escapeHtmlAttribute(part.link.trim())}">${html}</a>`;
    }
    return html;
  }).join('');
}

function blockHtml(block: Block): string {
  switch (block.kind) {
    case 'heading': {
      const level = block.level === 1 ? 2 : block.level;
      return `<h${level}>${inlineHtml(block.inline)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${inlineHtml(block.inline)}</p>`;
    case 'quote':
      return `<blockquote><p>${inlineHtml(block.inline)}</p></blockquote>`;
    case 'code':
      return `<pre><code>${escapeHtmlText(block.text)}</code></pre>`;
    case 'rule':
      return '<hr>';
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      const head = block.head.map((cell) => `<th>${inlineHtml(cell)}</th>`).join('');
      const rows = block.rows.map((row) => `<tr>${block.head.map((_, index) =>
        `<td>${inlineHtml(row[index] ?? [])}</td>`).join('')}</tr>`).join('');
      return `<table class="rt"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    case 'image': {
      if (!LOCAL_IMAGE.test(block.src)) {
        return `<p class="f3">图片没带进来：${escapeHtmlText(block.src)}</p>`;
      }
      const caption = block.alt === '' ? '' : `<figcaption>${escapeHtmlText(block.alt)}</figcaption>`;
      return `<figure class="img"><img src="${escapeHtmlAttribute(block.src)}" alt="${escapeHtmlAttribute(block.alt)}">`
        + `${caption}</figure>`;
    }
  }
}

export function leadingTitle(blocks: readonly Block[]): string | null {
  const first = blocks[0];
  return first?.kind === 'heading' && first.level === 1 ? first.inline.map((part) => part.text).join('').trim() : null;
}

export function reportFragment(blocks: readonly Block[], fallbackTitle: string): string {
  const title = leadingTitle(blocks);
  const body = title === null ? blocks : blocks.slice(1);
  const sections: Block[][] = [];
  for (const block of body) {
    if ((block.kind === 'heading' && block.level <= 2) || sections.length === 0) sections.push([]);
    sections.at(-1)?.push(block);
  }
  const hero = `<header class="rp-hero"><h1 class="rp-h1">${escapeHtmlText(title ?? fallbackTitle)}</h1></header>`;
  return hero + sections.map((section, index) =>
    `<section class="rp-sec" id="s${index + 1}">${section.map(blockHtml).join('')}</section>`).join('');
}
