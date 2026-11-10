import type { WebExtractView } from './api/web-extract.ts';
import { escapeHtmlAttribute as attr, escapeHtmlText as text } from './space-html.ts';

export interface ArchiveImage { src: string; alt: string; afterText: string }
const CSS = `.wa{max-width:840px;margin:auto;padding:32px 32px 64px;line-height:1.8;font-size:16px}
.wa-meta{display:flex;gap:12px;flex-wrap:wrap;color:var(--fg2);font-size:12px}.wa a{color:var(--fg2)}
.wa h1{font-size:28px;font-weight:600;line-height:1.4;margin:24px 0}.wa h2{font-size:20px;font-weight:600}
.wa-key{border-block:1px solid var(--line);padding:16px 0;margin:24px 0}.wa-key h2{font-size:13px;color:var(--fg2)}
.wa-key ol{padding-left:24px}.wa-key li{padding:4px 0}.wa-key li::marker{color:var(--fg3);font-family:var(--mono)}
.wa mark{color:inherit;background:color-mix(in srgb,var(--hue-ochre) 20%,transparent)}
.wa figure{margin:24px 0}.wa img{display:block;max-width:100%;height:auto;border-radius:8px}
.wa figcaption,.wa-footer{color:var(--fg3);font-size:12px}.wa p{margin:16px 0}
@media(max-width:600px){.wa{padding:24px 16px 48px}.wa h1{font-size:24px}}`;

function highlighted(source: string, quotes: readonly string[]): string {
  const ranges: { start: number; end: number }[] = [];
  for (const quote of quotes) {
    const start = source.indexOf(quote);
    if (start >= 0) ranges.push({ start, end: start + quote.length });
  }
  ranges.sort((a, b) => a.start - b.start);
  let offset = 0;
  let html = '';
  for (const range of ranges) {
    if (range.start < offset) continue;
    html += text(source.slice(offset, range.start)) + `<mark>${text(source.slice(range.start, range.end))}</mark>`;
    offset = range.end;
  }
  return html + text(source.slice(offset));
}

export function renderWebArchive(page: WebExtractView, images: readonly ArchiveImage[], at: Date,
  timeZone = 'Asia/Shanghai'): string {
  const picture = (image: ArchiveImage): string => `<figure><img src="${attr(image.src)}" alt="${attr(image.alt)}">`
    + `${image.alt === '' ? '' : `<figcaption>${text(image.alt)}</figcaption>`}</figure>`;
  const before = images.filter((image) => image.afterText === '').map(picture).join('');
  const body = page.blocks.map((block) => {
    const tag = block.kind === 'heading' ? 'h2' : 'p';
    const quotes = page.points.filter((point) => point.block === block.index).map((point) => point.quote);
    return `<${tag} id="web-block-${block.index}">${highlighted(block.text, quotes)}</${tag}>`
      + images.filter((image) => image.afterText !== '' && block.text.includes(image.afterText)).map(picture).join('');
  }).join('');
  const points = page.points.map((point) => `<li><a href="#web-block-${point.block}">${text(point.text)}</a></li>`)
    .join('');
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone, month: '2-digit', day: '2-digit' }).format(at);
  const kept = page.blocks.reduce((sum, block) => sum + [...block.text].length, 0);
  return `<style>${CSS}</style><article class="wa"><header><div class="wa-meta">`
    + `<span>${text(new URL(page.url).hostname)} · 存于 ${date}</span><a href="${attr(page.url)}">原网页</a>`
    + `</div><h1>${text(page.title || new URL(page.url).hostname)}</h1></header>`
    + `${points === '' ? '' : `<section class="wa-key"><h2>重点</h2><ol>${points}</ol></section>`}`
    + `${before}${body}<footer class="wa-footer">原网页 ${page.totalChars.toLocaleString('zh-CN')} 字，`
    + `精简后 ${kept.toLocaleString('zh-CN')} 字${page.truncated ? ' · 原文只读取了前面一部分' : ''}</footer></article>`;
}
