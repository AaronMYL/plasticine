// 图书笔记的网页排版；真实接口和开发假数据共用，所有内容仍来自已有大纲或重点。
import { escapeHtmlText as text, escapeHtmlAttribute as attr } from './space-html.ts';
import type { BookKeyPoints, BookOutline, BookTocEntry } from './state-books.ts';

export interface BookPageInput {
  bookId: string;
  toc: readonly BookTocEntry[];
  currentChapter: number | null;
  outline?: BookOutline;
  keyPoints?: BookKeyPoints;
  dismissedPointIds?: readonly string[];
}

const LEGACY_CSS = `.bn{max-width:800px;margin:auto;padding:24px 20px 48px;font-size:14px;line-height:1.7}
.bn h1{font-size:17px;line-height:1.65;font-weight:600;margin:0 0 20px}.bn h2{font-size:15px;font-weight:600}
.bn-bar{display:flex;height:8px;gap:2px;border-radius:4px;overflow:hidden}.bn-bar span{min-width:2px}
.bn-legend{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 24px;font-size:12px;color:var(--fg2)}
.bn-legend i{width:6px;height:6px;display:inline-block;border-radius:50%;margin-right:4px}
.bn-list{list-style:none;margin:0;padding:0}.bn-row{display:grid;grid-template-columns:24px 1fr;gap:12px;
padding:16px 0;border-bottom:1px solid var(--line)}.bn-index{font-family:var(--mono);color:var(--fg3)}
.bn-summary{color:var(--fg2);margin:6px 0}.bn-back{font-size:12px;color:var(--fg2);text-underline-offset:4px}
.bn-current{font-size:12px;color:var(--fg2);font-weight:400;margin-left:8px}.bn-current::before{content:'●';
color:var(--fg3);margin-right:6px}.bn-current[hidden]{display:none}
.bn-point{padding:16px 0;border-bottom:1px solid var(--line)}
.bn-category{font-size:11px;padding:2px 6px;border-radius:4px;background:var(--tint2);color:var(--fg2)}
.bn-point p{margin:8px 0}.bn-point blockquote{border-left:1px solid var(--line2);margin:12px 0;
padding-left:12px;
color:var(--fg2);font-size:13px}@media(max-width:480px){.bn{padding:20px 16px 40px}}`;
// 11-11 第 11 批设计稿「P4 读书笔记」：去掉各部分字数比例的色条和图例，其余不变。旧版样式和正文留着只为认出旧生成页。
const CSS = LEGACY_CSS.replace(/\.bn-bar\{[^\n]*\n\.bn-legend\{[^\n]*\n\.bn-legend i\{[^\n]*\n/u, '');
const HUES = ['sky', 'teal', 'ochre', 'rose', 'sage', 'slate'] as const;

function link(bookId: string, chapter: number, offset = 0): string {
  return `<a class="bn-back" data-link="book:${attr(encodeURIComponent(bookId))}:${chapter}:${offset}"`
    + ' href="#">↗ 回到原文这一段</a>';
}

/** legacy：照 11-11 以前的样子画（带色条），只用来认出旧版自动生成的页面，不再写出去。 */
export function renderBookPage(input: BookPageInput, options: { legacy?: boolean } = {}): string {
  const legacy = options.legacy === true;
  const { bookId, toc, outline } = input;
  let body: string;
  if (outline !== undefined) {
    const groups = [...outline.parts].filter((part) => part.chapter < toc.length)
      .sort((a, b) => a.chapter - b.chapter);
    const weights = groups.map((part, index) => toc.slice(part.chapter, groups[index + 1]?.chapter ?? toc.length)
      .reduce((total, entry) => total + entry.chars, 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const color = (index: number): string => `var(--hue-${HUES[index % HUES.length]})`;
    const bar = groups.map((part, index) => `<span title="${attr(part.title)}" style="width:`
      + `${(total === 0 ? 100 / Math.max(groups.length, 1) : weights[index]! / total * 100).toFixed(2)}%;`
      + `background:${color(index)}"></span>`).join('');
    const legend = groups.map((part, index) => `<span><i style="background:${color(index)}"></i>`
      + `${text(part.title)}</span>`).join('');
    const chapters = outline.chapters ?? groups;
    const rows = chapters.filter((part) => part.chapter < toc.length).map((part) => {
      const current = part.chapter === input.currentChapter;
      return `<li class="bn-row" data-book-chapter="${part.chapter}"><span class="bn-index">`
        + `${String(part.chapter + 1).padStart(2, '0')}</span><div><h2>${text(part.title)}`
        + `<span class="bn-current"${current ? '' : ' hidden'}>读到这里</span></h2>`
        + `<p class="bn-summary">${text(part.summary)}</p>${link(bookId, part.chapter, part.offset ?? 0)}</div></li>`;
    }).join('');
    const heading = outline.summary?.trim() ? `一句话：${text(outline.summary)}` : '图书大纲';
    body = legacy ? `<h1>${heading}</h1><div class="bn-bar" role="img" aria-label="各部分字数比例">`
      + `${bar}</div><div class="bn-legend">${legend}</div><ol class="bn-list">${rows}</ol>`
      : `<h1>${heading}</h1><ol class="bn-list">${rows}</ol>`;
  } else {
    const points = (input.keyPoints?.points ?? []).filter((point) => !input.dismissedPointIds?.includes(point.id));
    body = `<h1>值得记住的 ${points.length} 个重点</h1>${points.map((point) => {
      const category = point.category ?? (point.basis === 'quoted' ? '原文要点' : '延伸思考');
      return `<section class="bn-point" data-point-id="${attr(point.id)}"><span class="bn-category">`
        + `${text(category)}</span><p>${text(point.text)}</p>${point.anchors.map((anchor) =>
          `<blockquote>${text(anchor.quote)}</blockquote>${link(bookId, anchor.chapter, anchor.start)}`)
        .join('')}</section>`;
    }).join('')}`;
  }
  return `<style>${legacy ? LEGACY_CSS : CSS}</style>`
    + `<article class="bn" data-book-id="${attr(bookId)}">${body}</article>`;
}
