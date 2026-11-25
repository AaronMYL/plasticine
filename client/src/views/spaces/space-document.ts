import type { SpaceDoc, SpaceGenre } from '../../api/shared.ts';
import { plasticineMarkSvg } from '../../shell/plasticine-mark.tsx';
import { SPACE_PARAGRAPH_SELECTOR } from '../../../../agent/shared/space-selection.ts';
import { LETTER_AI_MARK } from '../../../../agent/shared/space-page/letter-css.ts';

const EDITABLE = 'p, h1, h2, h3, h4, h5, li, td, th, dt, dd, figcaption, blockquote, .lst > div > span, .chain > span';
const FIXED = 'figure.ch, svg, .rp-stats, .facts, .tk, [data-fixed]';
const SKIP = 'script, style, template';
const ASSET_PREFIX = '/v2/';
const TOC_MIN_SECTIONS = 3;

export interface PreparedSpace {
  pristine: Document;
  body: string;
  editable: number;
}

export interface PrepareInput {
  html: string;
  genre: SpaceGenre;
  title: string;
  dateLabel: string;
  signer?: LetterSigner;
}

export interface LetterSigner {
  name: string;
  mark: string;
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

function addNav(doc: Document): void {
  doc.body.querySelectorAll('nav.rp-nav').forEach((nav) => nav.remove());
  const sections = [...doc.body.querySelectorAll<HTMLElement>(':scope > section[id], :scope > .rp-sec[id]')];
  if (sections.length < TOC_MIN_SECTIONS) {
    return;
  }
  const links = sections.map((section) => {
    const label = section.dataset['toc'] ?? section.querySelector('h2')?.textContent ?? section.id;
    return `<a href="#${encodeURIComponent(section.id)}">${escapeText(label.trim())}</a>`;
  }).join('');
  sections[0]?.insertAdjacentHTML('beforebegin', `<nav class="rp-nav" aria-label="目录">${links}</nav>`);
}

function reportBody(frame: Document): string {
  const body = frame.body;
  const hero = body.querySelector(':scope > header.rp-hero');
  if (hero !== null) {
    body.prepend(hero);
    const kick = hero.querySelector(':scope > .rp-kick') ?? body.querySelector(':scope > .rp-kick');
    if (kick !== null) hero.before(kick);
    const stats = hero.querySelector(':scope > .rp-stats');
    if (stats !== null) hero.after(stats);
  }
  addNav(frame);
  return `<div class="rp">${body.innerHTML}</div>`;
}

function tidyLetter(frame: Document): void {
  for (const figure of frame.body.querySelectorAll('figure.lt-fig')) {
    if (figure.querySelector('img') === null && figure.querySelector('svg.lt-draw') !== null) figure.remove();
  }
  for (const credit of frame.body.querySelectorAll('figure.lt-fig .lt-credit')) {
    const figure = credit.closest('figure');
    credit.remove();
    if (figure !== null && figure.querySelector(':scope > .lt-ai') === null) {
      figure.querySelector('img')?.insertAdjacentHTML('afterend', LETTER_AI_MARK);
    }
  }
}

function letterBody(frame: Document, input: PrepareInput): string {
  tidyLetter(frame);
  const mark = input.signer?.mark ?? plasticineMarkSvg(24);
  const name = input.signer?.name ?? 'Plasticine';
  return `<article class="lt"><p class="lt-date">${escapeText(input.dateLabel)}</p>`
    + `<h1 class="lt-title">${escapeText(input.title)}</h1><div class="lt-body">${frame.body.innerHTML}</div>`
    + `<p class="lt-sign">— ${escapeText(name)}${mark}</p></article>`;
}

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

export function applySpaceEdit(prepared: PreparedSpace, index: number, html: string): string {
  const target = prepared.pristine.body.querySelector<HTMLElement>(`[data-e="${index}"]`);
  if (target === null) {
    throw new Error(`页面上没有第 ${index} 段可改`);
  }
  target.innerHTML = html;
  return spaceFragment(prepared.pristine);
}

export function spaceFragment(doc: Document): string {
  const copy = doc.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-e]').forEach((element) => element.removeAttribute('data-e'));
  copy.querySelectorAll('[data-qp]').forEach((element) => element.removeAttribute('data-qp'));
  return copy.innerHTML;
}

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
