import {
  SPACE_HTML_MAX_CHARS,
  SPACE_STATS_MAX,
  type SpaceDoc,
  type SpaceGenre,
} from '../../shared/state.ts';
import { findAll, hasAttribute, hasClass, parseHtml, textOf, type HtmlElement } from '../../shared/space-html.ts';
import { cleanOutboundText, EXTERNAL_LINK } from '../util/index.ts';
import { SubsError } from './errors.ts';
import { sanitizeSpaceHtml, type SanitizedHtml } from './space-sanitize.ts';

const TEXT_MIN_CHARS = 10;
export const SPACE_EDITS_MAX = 50;
const STAT_VALUE_MAX = 16;
const STAT_LABEL_MAX = 40;
const HEADLINE_MAX = 200;

export interface SpaceEdit {
  oldText: string;
  newText: string;
}

function cleanHtmlLinks(html: string): string {
  return html.replace(EXTERNAL_LINK, (raw) => cleanOutboundText(raw.replaceAll('&amp;', '&')).replaceAll('&', '&amp;'));
}

export function checkSpacePage(genre: SpaceGenre, html: string): SanitizedHtml {
  const sanitized = sanitizeSpaceHtml(html);
  const cleaned = genre === 'letter' ? { ...sanitized, html: cleanHtmlLinks(sanitized.html) } : sanitized;
  if (cleaned.html.length > SPACE_HTML_MAX_CHARS) {
    throw new SubsError('invalid', `正文太长了（${cleaned.html.length} 字符，上限 ${SPACE_HTML_MAX_CHARS}）：`
      + '图表用内联 SVG 但别塞原始数据表，长的拆成几个空间。');
  }
  const tree = parseHtml(cleaned.html);
  if (textOf(tree).length < TEXT_MIN_CHARS) {
    throw new SubsError('invalid', '正文是空的：html 要写 body 里的内容（报告从结论大标题写起，来信从第一段写起）。');
  }
  if (genre === 'letter' && findAll(tree, (element) => element.name === 'h1').length > 0) {
    throw new SubsError('invalid', '来信的题目、日期和署名由信纸套上：正文里不写 h1，也不写署名，从第一段（lt-lead）写起。');
  }
  return cleaned;
}

function occurrences(text: string, part: string): number {
  let count = 0;
  let at = text.indexOf(part);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(part, at + part.length);
  }
  return count;
}

export function editSpaceHtml(html: string, edits: readonly SpaceEdit[]): string {
  if (edits.length === 0) {
    throw new SubsError('invalid', '没有要改的：edits 至少一条。');
  }
  let current = html;
  edits.forEach((edit, index) => {
    const found = edit.oldText === '' ? 0 : occurrences(current, edit.oldText);
    if (found !== 1) {
      throw new SubsError('invalid', found === 0
        ? `第 ${index + 1} 条的原文在当前正文里找不到：先 space_read 拿到最新的 html，原文照抄（含标签和空格）。`
        : `第 ${index + 1} 条的原文出现了 ${found} 次：多带一点前后文，让它只出现一次。`);
    }
    current = current.replace(edit.oldText, () => edit.newText);
  });
  return current;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

function firstByClass(root: HtmlElement, name: string): HtmlElement | undefined {
  return findAll(root, (element) => hasClass(element, name))[0];
}

function statsOf(tree: HtmlElement): SpaceDoc['stats'] {
  return findAll(tree, (element) => hasClass(element, 'rp-stat')).slice(0, SPACE_STATS_MAX).flatMap((stat) => {
    const value = firstByClass(stat, 'v');
    const label = firstByClass(stat, 'l');
    if (value === undefined || label === undefined) return [];
    const parts = value.children.flatMap((child) => (child.kind === 'element' ? [textOf(child)] : []))
      .filter((part) => part !== '');
    const valueText = clip(parts.length > 1 ? parts.join(' ') : textOf(value).replace(/\n/g, ' '), STAT_VALUE_MAX);
    const labelText = clip(textOf(label).replace(/\n/g, ' '), STAT_LABEL_MAX);
    return valueText === '' || labelText === '' ? [] : [{ value: valueText, label: labelText }];
  });
}

export function pageSummary(title: string, genre: SpaceGenre, html: string):
  { headline: string; stats: SpaceDoc['stats'] } {
  if (genre === 'letter') {
    return { headline: title, stats: [] };
  }
  const tree = parseHtml(html);
  const h1 = findAll(tree, (element) => element.name === 'h1')[0];
  return { headline: h1 === undefined ? title : clip(textOf(h1), HEADLINE_MAX), stats: statsOf(tree) };
}

const MESSAGE_LINK = /<a\b[^>]*?\sdata-link\s*=\s*(["'])message:([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;

export function dropDeadMessageLinks(html: string, exists: (ref: string) => boolean): string {
  return html.replace(MESSAGE_LINK, (whole: string, _quote: string, ref: string, inner: string) =>
    (exists(ref) ? whole : inner));
}

export function followTexts(html: string): string[] {
  return findAll(parseHtml(html), (element) => hasAttribute(element, 'data-follow'))
    .map((element) => textOf(element).replace(/\s+/g, ' ').trim()).filter((text) => text !== '');
}
