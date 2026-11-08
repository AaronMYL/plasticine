// 沉浸式翻译的切段规则（Mac 0.4.0，第 2 批）：哪些块能整段译、取出原文、判断是不是已经是目标语言。纯函数，只看 DOM，
// 不改页面。translate-page.ts 用它；scripts/generate-translate-script.ts 把这几份去掉类型后拼成一段注入网页标签。
// 自足：不引别的值（只能 import type）。

/** 这几个数和 agent/shared/api 里的上限一致（这里不能引值，测试核对两边一样）。 */
export const PAGE_LIMITS = {
  /** 一批最多几段（TRANSLATE_BATCH_MAX_ITEMS）。 */
  batchItems: 24,
  /** 一批最多多少字（TRANSLATE_BATCH_MAX_CHARS）。 */
  batchChars: 12_000,
  /** 一段最多多少字（TRANSLATE_ITEM_MAX_CHARS）；更长的整块不译。 */
  itemChars: 4_000,
  /** 「问这一段」带上的原文、译文上限（TRANSLATE_ASK_MAX_CHARS）。 */
  askChars: 8_000,
};

export const SKIP_SELECTOR = [
  'nav', 'button', 'input', 'textarea', 'select', 'option', 'code', 'pre', 'kbd', 'samp', 'script', 'style',
  'noscript', 'template', 'svg', 'math', 'canvas', 'video', 'audio', 'iframe', 'object', 'plasticine-tr',
  'plasticine-toolbar', '[contenteditable]:not([contenteditable="false"])', '[aria-hidden="true"]', '[hidden]',
  '[translate="no"]', '.notranslate', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="button"]', '[role="menu"]', '[role="menubar"]', '[role="toolbar"]', '[role="tablist"]', '[role="search"]',
  '[role="textbox"]', '[role="combobox"]', '[role="listbox"]',
].join(', ');
// 行内的标签：一个块里只有这些子元素，它就是一个能整段译的段落。
export const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT', 'I',
  'IMG', 'INS', 'MARK', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR',
  'WBR', 'LABEL', 'CODE', 'KBD', 'SAMP']);
// 这些块就算只有一个链接也译（博客目录的标题、表格里的链接）；别的块整段都在链接里就是菜单、用户名，不译。
const LINK_OK_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DT', 'DD', 'CAPTION']);
export const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
// 段落一类：一个词也译；别的容器（div 之类）至少两个词才译，免得把界面上的零碎字当正文。
const PROSE_TAGS = new Set(['P', 'LI', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'SUMMARY',
  ...HEADING_TAGS]);
export const CARD_FIELDS = 'input[autocomplete^="cc-" i], input[name*="cardnumber" i], input[name*="card_number" i], '
  + 'input[name*="cvv" i], input[name*="cvc" i]';
const ENGLISH_WORDS = new Set(['the', 'and', 'of', 'to', 'is', 'in', 'that', 'for', 'it', 'with', 'as', 'was', 'on',
  'are', 'be', 'this', 'by', 'you', 'not', 'or', 'have', 'from', 'but', 'what', 'an', 'they', 'we', 'can', 'will']);

export function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** 元素里的字，不算我们插进去的译文；<br> 和块之间当一个空格，连续空白并成一个。 */
export function sourceText(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        parts.push(child.nodeValue ?? '');
      } else if (child.nodeType === 1) {
        const tag = (child as Element).tagName;
        if (tag === 'PLASTICINE-TR' || tag === 'SCRIPT' || tag === 'STYLE') {
          continue;
        }
        if (tag === 'BR') {
          parts.push(' ');
          continue;
        }
        walk(child);
      }
    }
  };
  walk(element);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function letters(text: string, script: RegExp): number {
  return (text.match(script) ?? []).length;
}

/** 这段是不是已经是目标语言：看 lang 属性，再看用的文字。 */
export function alreadyTarget(text: string, target: string, lang: string): boolean {
  const base = target.split('-')[0] ?? target;
  const declared = lang.toLowerCase();
  if (declared !== '' && declared.split('-')[0] === base) {
    return true;
  }
  const han = letters(text, /\p{Script=Han}/gu);
  const kana = letters(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = letters(text, /\p{Script=Hangul}/gu);
  const latin = letters(text, /\p{Script=Latin}/gu);
  const total = han + kana + hangul + latin;
  if (total === 0) {
    return true;
  }
  if (base === 'zh') {
    return kana === 0 && han / total >= 0.4;
  }
  if (base === 'ja') {
    return kana > 0 && (han + kana) / total >= 0.4;
  }
  if (base === 'ko') {
    return hangul / total >= 0.4;
  }
  if (latin / total < 0.6) {
    return false;
  }
  if (base === 'en') {
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    const common = words.filter((word) => ENGLISH_WORDS.has(word)).length;
    return words.length >= 4 && common / words.length >= 0.15;
  }
  return false;
}

function inlineOnly(element: Element): boolean {
  for (const child of Array.from(element.children)) {
    if (child.tagName.startsWith('PLASTICINE-')) {
      continue;
    }
    if (!INLINE_TAGS.has(child.tagName) && !child.tagName.includes('-')) {
      return false;
    }
    if (!inlineOnly(child)) {
      return false;
    }
  }
  return true;
}

function skipped(element: Element): boolean {
  if (element.closest(SKIP_SELECTOR) !== null) {
    return true;
  }
  // 页面自己的页头页脚不译；文章里的 <header>（标题、署名）照译。
  const edge = element.closest('header, footer');
  return edge !== null && edge.closest('article, main') === null;
}

function linkOnly(element: Element, text: string): boolean {
  const links = Array.from(element.querySelectorAll('a'));
  if (links.length === 0) {
    return false;
  }
  const linked = links.map((link) => sourceText(link)).join(' ').replace(/\s+/g, '');
  return linked.length >= text.replace(/\s+/g, '').length;
}

function wordy(element: Element, text: string): boolean {
  const meaningful = letters(text, /[\p{L}]/gu);
  if (meaningful < 2) {
    return false;
  }
  if (PROSE_TAGS.has(element.tagName)) {
    return true;
  }
  return /\s/.test(text) || letters(text, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) >= 4;
}

/** 能整段译的块：只含行内元素、它的父元素不是（取最大的那一块）、不在跳过的区域里、字够多。 */
export function isCandidate(element: Element): boolean {
  if (element.tagName === 'BODY' || element.tagName === 'HTML') {
    return false;
  }
  if (!inlineOnly(element) || skipped(element)) {
    return false;
  }
  // 父元素也只含行内元素时，整段该从父元素译（取最大的那一块）。
  const parent = element.parentElement;
  if (parent !== null && parent.tagName !== 'BODY' && inlineOnly(parent) && !skipped(parent)) {
    return false;
  }
  const text = sourceText(element);
  if (text === '' || Array.from(text).length > PAGE_LIMITS.itemChars || !wordy(element, text)) {
    return false;
  }
  return LINK_OK_TAGS.has(element.tagName) || !linkOnly(element, text);
}

/** 一棵子树里能整段译的块（包括它自己）。 */
export function candidatesIn(root: Element): Element[] {
  const found: Element[] = [];
  const visit = (element: Element): void => {
    if (element.matches(SKIP_SELECTOR)) {
      return;
    }
    if (isCandidate(element)) {
      found.push(element);
      return;
    }
    for (const child of Array.from(element.children)) {
      visit(child);
    }
  };
  visit(root);
  return found;
}

export function langOf(element: Element): string {
  return element.closest('[lang]')?.getAttribute('lang') ?? '';
}
