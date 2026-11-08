// 网页标签的 DOM 动作（tab_read、tab_click、tab_fill 和「问这一页」的可见正文），跑在网页标签 preload 的独立脚本世界里
// （页面自己的脚本碰不到）。照搬 Mac 壳 web-tab-dom.swift 里的几段脚本：读正文分段、找元素并打记号、点之前之后读页面
// 状态、用原生 setter 填值再发 input / change（React 这类页面也认），密码框的值从不回传。

const MARK = 'data-plasticine-target';
const READ_TEXT_CHARS = 12_000;
const READ_LINKS = 40;
const READ_FIELDS = 30;
const LINK_TEXT_CHARS = 80;
const LINK_HREF_CHARS = 300;
const FIELD_VALUE_CHARS = 200;
const CLICKABLE = 'a, button, input[type=button], input[type=submit], input[type=reset], input[type=image], '
  + 'summary, label, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], [onclick]';
const EDITABLE = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
const CHECKED_WORDS = /^(true|on|1|yes|是|勾选|选中)$/i;

export function clip(value: unknown, max: number): string {
  const chars = Array.from(String(value ?? ''));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

function visible(element: Element): boolean {
  if (element.getClientRects().length === 0) {
    return false;
  }
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function norm(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function textOf(element: Element): string {
  const html = element as HTMLElement & { value?: unknown };
  return html.innerText || (typeof html.value === 'string' ? html.value : '') || element.getAttribute('aria-label')
    || html.title || '';
}

function unique(doc: Document, selector: string): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch (error) {
    if (error instanceof DOMException) {
      return false;
    }
    throw error;
  }
}

function selectorOf(doc: Document, element: Element): string {
  if (element.id !== '' && unique(doc, `#${CSS.escape(element.id)}`)) {
    return `#${CSS.escape(element.id)}`;
  }
  const tag = element.tagName.toLowerCase();
  const name = element.getAttribute('name');
  const byName = name === null ? null : `${tag}[name="${CSS.escape(name)}"]`;
  if (byName !== null && unique(doc, byName)) {
    return byName;
  }
  const parts: string[] = [];
  for (let node: Element | null = element; node?.parentElement && node !== doc.body; node = node.parentElement) {
    const current: Element = node;
    const same = Array.from(current.parentElement?.children ?? []).filter((child) => child.tagName === current.tagName);
    const own = current.tagName.toLowerCase();
    parts.unshift(same.length > 1 ? `${own}:nth-of-type(${same.indexOf(current) + 1})` : own);
    if (current.id !== '' && unique(doc, `#${CSS.escape(current.id)}`)) {
      parts[0] = `#${CSS.escape(current.id)}`;
      break;
    }
  }
  return parts.join(' > ');
}

function labelOf(element: HTMLInputElement): string {
  return (element.labels?.[0]?.innerText ?? '') || element.getAttribute('aria-label')
    || element.getAttribute('placeholder') || element.title || '';
}

function marked(doc: Document, nonce: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[${MARK}="${CSS.escape(nonce)}"]`);
}

export function readPage(doc: Document, offset: number): Record<string, unknown> {
  const text = Array.from(doc.body?.innerText ?? '');
  const slice = text.slice(offset, offset + READ_TEXT_CHARS).join('');
  const nextOffset = offset + READ_TEXT_CHARS < text.length ? offset + READ_TEXT_CHARS : null;
  const links: { text: string; href: string }[] = [];
  const fields: Record<string, unknown>[] = [];
  let linksTruncated = false;
  let fieldsTruncated = false;
  if (offset === 0) {
    for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (!/^https?:/i.test(anchor.href) || !visible(anchor)) {
        continue;
      }
      if (links.length >= READ_LINKS) {
        linksTruncated = true;
        break;
      }
      links.push({ text: clip(textOf(anchor).trim(), LINK_TEXT_CHARS), href: clip(anchor.href, LINK_HREF_CHARS) });
    }
    for (const element of doc.querySelectorAll<HTMLElement & { value?: string; checked?: boolean;
      disabled?: boolean }>(EDITABLE)) {
      const type = (element.getAttribute('type') ?? '').toLowerCase();
      if (type === 'hidden' || !visible(element)) {
        continue;
      }
      if (fields.length >= READ_FIELDS) {
        fieldsTruncated = true;
        break;
      }
      const tag = element.tagName.toLowerCase();
      const rich = !('value' in element) && element.isContentEditable;
      const checkable = type === 'checkbox' || type === 'radio';
      const shown = type || (tag === 'input' ? 'text' : rich ? 'contenteditable' : tag);
      fields.push({ selector: clip(selectorOf(doc, element), 200), tag, type: shown,
        name: clip(element.getAttribute('name') ?? '', 80), label: clip(labelOf(element as HTMLInputElement), 80),
        value: type === 'password' ? null : clip(rich ? element.innerText : element.value ?? '', FIELD_VALUE_CHARS),
        checked: checkable ? element.checked === true : null, disabled: element.disabled === true });
    }
  }
  return { url: doc.location.href, title: doc.title, text: slice, offset, totalChars: text.length, nextOffset, links,
    fields, linksTruncated, fieldsTruncated };
}

/** 找到的元素在真实 DOM 上的样子：设备按它再判一次道（页面地址、表单地址、按钮上的字、密码框）。 */
export interface TargetFacts {
  pageUrl: string;
  label: string;
  name: string;
  autocomplete: string;
  formAction: string;
  isPassword: boolean;
  formHasPassword: boolean;
}

export type Located = { found: true; count: number; facts: TargetFacts; tag: string; text: string }
  | { found: false; error: 'selector' | 'missing'; count: number };

export function locate(doc: Document, selector: string | null, text: string | null, nonce: string): Located {
  let element: Element | null = null;
  let count = 0;
  if (selector !== null) {
    let all: Element[];
    try {
      all = Array.from(doc.querySelectorAll(selector));
    } catch (error) {
      if (error instanceof DOMException) {
        return { found: false, error: 'selector', count: 0 };
      }
      throw error;
    }
    count = all.length;
    element = all.find(visible) ?? all[0] ?? null;
  } else {
    const want = norm(text);
    const candidates = Array.from(doc.querySelectorAll(CLICKABLE)).filter(visible);
    const exact = candidates.filter((candidate) => norm(textOf(candidate)) === want);
    const loose = exact.length > 0 ? exact : candidates.filter((candidate) => norm(textOf(candidate)).includes(want));
    count = loose.length;
    element = loose[0] ?? null;
  }
  if (element === null) {
    return { found: false, error: 'missing', count: 0 };
  }
  element.setAttribute(MARK, nonce);
  const input = element as HTMLInputElement;
  const form = input.form ?? element.closest('form');
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  const isPassword = type === 'password';
  const label = clip([isPassword ? '' : textOf(element), element.getAttribute('aria-label'), input.title,
    element.getAttribute('name'), element.id].filter(Boolean).join(' '), 300);
  const facts: TargetFacts = { pageUrl: doc.location.href, label,
    name: [element.getAttribute('name'), element.id].filter(Boolean).join(' '),
    autocomplete: element.getAttribute('autocomplete') ?? '',
    formAction: form?.getAttribute('action') ? (form as HTMLFormElement).action : '', isPassword,
    formHasPassword: form?.querySelector('input[type="password" i]') !== null && form !== null };
  return { found: true, count, facts, tag: element.tagName.toLowerCase(),
    text: clip(isPassword ? '' : norm(textOf(element)), 80) };
}

/** 点之前、之后读一次页面：地址、标题、正文和被点元素的状态拼起来（设备算摘要）。 */
export function pageState(doc: Document, nonce: string, cleanup: boolean): { url: string; title: string;
  state: string } {
  const element = marked(doc, nonce) as (HTMLElement & { checked?: unknown; value?: unknown; open?: unknown }) | null;
  const parts = [doc.location.href, doc.title, doc.body?.innerText ?? ''];
  if (element !== null) {
    parts.push(String(element.checked), String(typeof element.value === 'string' ? element.value.length : ''),
      String(element.open), ...['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'class']
        .map((name) => element.getAttribute(name) ?? ''), String(element.isConnected));
  } else {
    parts.push('gone');
  }
  parts.push(doc.activeElement?.tagName ?? '');
  if (cleanup && element !== null) {
    element.removeAttribute(MARK);
  }
  return { url: doc.location.href, title: doc.title, state: parts.join('\u0000') };
}

export function clickMarked(doc: Document, nonce: string): boolean {
  const element = marked(doc, nonce);
  if (element === null) {
    return false;
  }
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  element.focus({ preventScroll: true });
  const init = { bubbles: true, cancelable: true, composed: true, view: doc.defaultView, button: 0 };
  element.dispatchEvent(new PointerEvent('pointerdown', init));
  element.dispatchEvent(new MouseEvent('mousedown', init));
  element.dispatchEvent(new PointerEvent('pointerup', init));
  element.dispatchEvent(new MouseEvent('mouseup', init));
  element.click();
  return true;
}

export type Filled = { ok: true; matches: boolean; tag: string; type: string }
  | { ok: false; error: 'missing' | 'disabled' | 'option' | 'unfillable' };

function setValue(element: Element, proto: object, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter === undefined) {
    throw new Error('这个输入框没有 value 的 setter。');
  }
  setter.call(element, next);
}

export function fillMarked(doc: Document, nonce: string, value: string): Filled {
  const element = marked(doc, nonce) as HTMLInputElement | null;
  if (element === null) {
    return { ok: false, error: 'missing' };
  }
  element.removeAttribute(MARK);
  if (element.disabled === true || element.readOnly === true) {
    return { ok: false, error: 'disabled' };
  }
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  element.focus({ preventScroll: true });
  const fire = (): void => {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText',
      data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let matches: boolean;
  if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    const want = CHECKED_WORDS.test(value.trim());
    if (element.checked !== want) {
      element.click();
    }
    matches = element.checked === want;
  } else if (tag === 'input' || tag === 'textarea') {
    const view = doc.defaultView ?? window;
    setValue(element, tag === 'input' ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype, value);
    fire();
    matches = element.value === value;
  } else if (tag === 'select') {
    const select = element as unknown as HTMLSelectElement;
    const options = Array.from(select.options);
    const option = options.find((item) => item.value === value)
      ?? options.find((item) => item.text.trim() === value.trim());
    if (option === undefined) {
      return { ok: false, error: 'option' };
    }
    setValue(select, (doc.defaultView ?? window).HTMLSelectElement.prototype, option.value);
    fire();
    matches = select.value === option.value;
  } else if (element.isContentEditable) {
    element.textContent = value;
    fire();
    matches = element.innerText.trim() === value.trim();
  } else {
    return { ok: false, error: 'unfillable' };
  }
  return { ok: true, matches, tag, type: type || (tag === 'input' ? 'text' : tag) };
}

/** 「问这一页」：可见正文，超过上限截断并给出总字数（字数按 Unicode 字符算）。 */
export function visibleText(doc: Document, max: number): { url: string; title: string; text: string;
  totalChars: number; truncated: boolean } {
  const chars = Array.from(doc.body?.innerText ?? '');
  return { url: doc.location.href, title: doc.title, text: chars.slice(0, max).join(''), totalChars: chars.length,
    truncated: chars.length > max };
}

/** 记号元素在视口里的中心（CSS 像素）：DOM 点不动、要用调试协议点一次可信点击时用。看不见是 null。 */
export function markedCenter(doc: Document, nonce: string): { x: number; y: number } | null {
  const element = marked(doc, nonce);
  if (element === null) {
    return null;
  }
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}
