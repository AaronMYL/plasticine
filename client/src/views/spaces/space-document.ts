// 空间网页进 iframe 之前在外面做的几件（第 8 批第 6 条，设计稿 11-09）：
// - 解析一遍片段（DOMParser 不跑脚本），给能改的字编号（data-e）：✎ 改字时 iframe 交回「第几段改成了什么」，外面在
//   这份没跑过脚本的原样上换掉那一段再存——页面脚本改过的东西（筛选藏起来的卡片、目录高亮）不会被存进去；
// - 图表、数字条标成不能改（pz-fixed），✎ 时淡下去；
// - 插图（/v2/notes/assets/…）换成 data-pz-asset：沙盒里读不了，由外面读好传进去；
// - 套信纸：来信是「日期 · 题目 · 正文 · 署名 Plasticine」；报告有 3 节以上带 id 的 section 就配右侧目录。
// 旧版式（还没重写成网页）的空间在列表里也要缩略图：按结构化文档拼一页报告的开头（legacyPreviewHtml）。

import type { SpaceDoc, SpaceGenre } from '../../api/shared.ts';
import { plasticineMarkSvg } from '../../shell/plasticine-mark.tsx';
import { SPACE_PARAGRAPH_SELECTOR } from '../../../../agent/shared/space-selection.ts';

/** 能在页面上直接改的字。 */
const EDITABLE = 'p, h1, h2, h3, h4, h5, li, td, th, dt, dd, figcaption, blockquote, .lst > div > span, .chain > span';
/** 不能手改的：图表、数字条、关键数字（数字来自存下的数据）、脚本和样式。 */
const FIXED = 'figure.ch, svg, .rp-stats, .facts, .tk, [data-fixed]';
const SKIP = 'script, style, template';
const ASSET_PREFIX = '/v2/';
/** 3 节以上才配目录（设计稿：一两节的页面不要目录）。 */
const TOC_MIN_SECTIONS = 3;

export interface PreparedSpace {
  /** 原样（带编号、没跑过脚本）：改字时在它上面换。 */
  pristine: Document;
  /** 放进 iframe 的 body。 */
  body: string;
  /** 能改的有几段。 */
  editable: number;
}

export interface PrepareInput {
  html: string;
  genre: SpaceGenre;
  title: string;
  /** 来信的日期（「2026 年 11 月 9 日」）。 */
  dateLabel: string;
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`,
    'text/html');
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function numberEditable(doc: Document): number {
  let index = 0;
  for (const element of doc.body.querySelectorAll<HTMLElement>(EDITABLE)) {
    if (element.closest(FIXED) !== null || element.closest(SKIP) !== null
      || element.parentElement?.closest('[data-e]') !== null) {
      continue;
    }
    element.dataset['e'] = String(index);
    index += 1;
  }
  return index;
}

function tocOf(doc: Document): string | null {
  const sections = [...doc.body.querySelectorAll<HTMLElement>(':scope > section[id], :scope > .rp-sec[id]')];
  if (sections.length < TOC_MIN_SECTIONS) {
    return null;
  }
  const links = sections.map((section) => {
    const label = section.dataset['toc'] ?? section.querySelector('h2')?.textContent ?? section.id;
    return `<a href="#${encodeURIComponent(section.id)}">${escapeText(label.trim())}</a>`;
  }).join('');
  return `<aside class="rp-toc"><nav aria-label="目录">${links}</nav></aside>`;
}

function reportBody(frame: Document): string {
  const hero = frame.body.querySelector(':scope > header.rp-hero');
  hero?.remove();
  const toc = tocOf(frame);
  const main = frame.body.innerHTML;
  return `<div class="rp">${hero?.outerHTML ?? ''}<div class="rp-body${toc === null ? ' no-toc' : ''}">`
    + `<div class="rp-main">${main}</div>${toc ?? ''}</div></div>`;
}

function letterBody(frame: Document, input: PrepareInput): string {
  return `<article class="lt"><p class="lt-date">${escapeText(input.dateLabel)}</p>`
    + `<h1 class="lt-title">${escapeText(input.title)}</h1><div class="lt-body">${frame.body.innerHTML}</div>`
    + `<p class="lt-sign">${plasticineMarkSvg(24)}Plasticine</p></article>`;
}

/** 解析、编号、换插图、套版式。 */
export function prepareSpace(input: PrepareInput): PreparedSpace {
  const pristine = parse(input.html);
  const editable = numberEditable(pristine);
  let paragraph = 1;
  for (const element of pristine.body.querySelectorAll<HTMLElement>(SPACE_PARAGRAPH_SELECTOR)) {
    if (element.closest(SKIP) !== null || element.parentElement?.closest('[data-qp]') !== null) continue;
    element.dataset['qp'] = String(paragraph++);
  }
  const frame = parse(pristine.body.innerHTML);
  for (const element of frame.body.querySelectorAll(FIXED)) {
    if (element.parentElement?.closest(FIXED) === null) element.classList.add('pz-fixed');
  }
  for (const image of frame.body.querySelectorAll<HTMLImageElement>('img[src]')) {
    const src = image.getAttribute('src') ?? '';
    if (src.startsWith(ASSET_PREFIX)) {
      image.dataset['pzAsset'] = src;
      image.removeAttribute('src');
    }
  }
  const body = input.genre === 'letter' ? letterBody(frame, input) : reportBody(frame);
  return { pristine, body, editable };
}

/** 第 index 段改成 html（iframe 交回来的 innerHTML），返回整页片段（不带编号），用来存一版。 */
export function applySpaceEdit(prepared: PreparedSpace, index: number, html: string): string {
  const target = prepared.pristine.body.querySelector<HTMLElement>(`[data-e="${index}"]`);
  if (target === null) {
    throw new Error(`页面上没有第 ${index} 段可改`);
  }
  target.innerHTML = html;
  return spaceFragment(prepared.pristine);
}

/** 原样去掉编号，写回片段。 */
export function spaceFragment(doc: Document): string {
  const copy = doc.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-e]').forEach((element) => element.removeAttribute('data-e'));
  copy.querySelectorAll('[data-qp]').forEach((element) => element.removeAttribute('data-qp'));
  return copy.innerHTML;
}

/** 旧版式（结构化文档）在列表里的缩略图：拼一页报告的开头。 */
export function legacyPreviewHtml(doc: SpaceDoc, title: string): string {
  const stats = doc.stats.map((stat) => `<div class="rp-stat"><div class="v"><b>${escapeText(stat.value)}</b></div>`
    + `<div class="l">${escapeText(stat.label)}</div></div>`).join('');
  const heading = doc.blocks.find((block) => block.type === 'heading');
  const text = doc.blocks.find((block) => block.type === 'text');
  return `<header class="rp-hero">${doc.kicker === undefined ? '' : `<p class="rp-kick">${escapeText(doc.kicker)}</p>`}`
    + `<h1 class="rp-h1">${escapeText(doc.headline ?? title)}</h1>`
    + `${stats === '' ? '' : `<div class="rp-stats">${stats}</div>`}</header>`
    + (heading?.type === 'heading' ? `<section class="rp-sec"><h2>${escapeText(heading.text)}</h2>` : '<section>')
    + (text?.type === 'text' ? `<p>${escapeText(text.markdown.replace(/[#*>[\]^-]/g, ' ').slice(0, 300))}</p>` : '')
    + '</section>';
}
