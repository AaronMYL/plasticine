export const PAGE_LIMITS = {
  batchItems: 24,
  batchChars: 12_000,
  itemChars: 4_000,
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
export const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT',
  'I',
  'IMG', 'INS', 'MARK', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR',
  'WBR', 'LABEL', 'CODE', 'KBD', 'SAMP']);
const LINK_OK_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'DT', 'DD', 'CAPTION']);
export const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
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
  return /\s/.test(text) || letters(text,
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) >= 4;
}

export function isCandidate(element: Element): boolean {
  if (element.tagName === 'BODY' || element.tagName === 'HTML') {
    return false;
  }
  if (!inlineOnly(element) || skipped(element)) {
    return false;
  }
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
