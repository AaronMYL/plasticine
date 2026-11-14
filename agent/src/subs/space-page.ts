// 空间网页（第 8 批第 6 条）写之前的核对和改法：
// - checkSpacePage：清洗（space-sanitize.ts）、长度、得有正文；来信的题目和署名由信纸套上，正文里不写 h1。
// - editSpaceHtml：「找原文 → 换新文」的补丁（照 claude-artifacts 的 edit_version）：每条原文在当前正文里必须正好
//   出现一次，按顺序一条条换；有一条对不上整个不改。
// - pageSummary：信息流顶部、首页「回顾」、订阅往期用的那一句和几个数字，从网页里读（报告的 h1 和数字条）。

import {
  SPACE_HTML_MAX_CHARS,
  SPACE_STATS_MAX,
  type SpaceDoc,
  type SpaceGenre,
} from '../../shared/state.ts';
import { findAll, hasAttribute, hasClass, parseHtml, textOf, type HtmlElement } from '../../shared/space-html.ts';
import { SubsError } from './errors.ts';
import { sanitizeSpaceHtml, type SanitizedHtml } from './space-sanitize.ts';

// 正文至少要有这么多字（只有标签、没写东西的不算一页）。
const TEXT_MIN_CHARS = 10;
// 一次补丁最多这么多条：再多就整页重写。
export const SPACE_EDITS_MAX = 50;
const STAT_VALUE_MAX = 16;
const STAT_LABEL_MAX = 40;
const HEADLINE_MAX = 200;

export interface SpaceEdit {
  oldText: string;
  newText: string;
}

/** 清洗并核对一页；不合规抛 SubsError（一句能照着改的话）。 */
export function checkSpacePage(genre: SpaceGenre, html: string): SanitizedHtml {
  const cleaned = sanitizeSpaceHtml(html);
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

/** 按顺序换；原文找不到或不止一处就抛错，说是第几条。 */
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

/** 报告的数字条：每个 .rp-stat 里的 .v（数和单位）和 .l（说明）。 */
function statsOf(tree: HtmlElement): SpaceDoc['stats'] {
  return findAll(tree, (element) => hasClass(element, 'rp-stat')).slice(0, SPACE_STATS_MAX).flatMap((stat) => {
    const value = firstByClass(stat, 'v');
    const label = firstByClass(stat, 'l');
    if (value === undefined || label === undefined) return [];
    // 数和单位分开写的（<b>2</b><i>篇</i>）中间留一个空格。
    const parts = value.children.flatMap((child) => (child.kind === 'element' ? [textOf(child)] : []))
      .filter((part) => part !== '');
    const valueText = clip(parts.length > 1 ? parts.join(' ') : textOf(value).replace(/\n/g, ' '), STAT_VALUE_MAX);
    const labelText = clip(textOf(label).replace(/\n/g, ' '), STAT_LABEL_MAX);
    return valueText === '' || labelText === '' ? [] : [{ value: valueText, label: labelText }];
  });
}

/** 那一句和几个数字：报告取 h1 和数字条；来信就是它的题目（信的题目本来就是一句话）。 */
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

/**
 * 链到原对话（data-link="message:line:<线>:<序号>"）的出处，那一条找不到（模型编的、删了、形状不对）就去掉链接、
 * 留下字：点了跳不到那句原话的链接不放（11-14 Aaron）。
 */
export function dropDeadMessageLinks(html: string, exists: (ref: string) => boolean): string {
  return html.replace(MESSAGE_LINK, (whole: string, _quote: string, ref: string, inner: string) =>
    (exists(ref) ? whole : inner));
}

/** 「值得跟进」：网页里标了 data-follow 的那几条（列表项或一段）。 */
export function followTexts(html: string): string[] {
  return findAll(parseHtml(html), (element) => hasAttribute(element, 'data-follow'))
    .map((element) => textOf(element).replace(/\s+/g, ' ').trim()).filter((text) => text !== '');
}
