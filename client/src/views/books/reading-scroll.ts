import { rangeBetween, textOffset } from './text-offsets.ts';

const BLOCKS = 'p, h2, h3, h4, li, pre';
const JUMP_MARGIN = 48;
const READ_PAST = 8;

export function offsetAtTop(root: HTMLElement, page: HTMLElement): number {
  if (page.scrollTop <= 0) {
    return 0;
  }
  if (page.scrollTop + page.clientHeight >= page.scrollHeight - READ_PAST) {
    return (root.textContent ?? '').length;
  }
  const top = page.getBoundingClientRect().top + READ_PAST;
  for (const block of root.querySelectorAll<HTMLElement>(BLOCKS)) {
    if (block.getBoundingClientRect().bottom > top) {
      return textOffset(root, block, 0) ?? 0;
    }
  }
  return (root.textContent ?? '').length;
}

export function scrollToOffset(root: HTMLElement, page: HTMLElement, offset: number): void {
  if (offset <= 0) {
    page.scrollTop = 0;
    return;
  }
  const range = rangeBetween(root, offset, offset + 1);
  if (range === null || typeof range.getBoundingClientRect !== 'function') {
    return;
  }
  const rect = range.getBoundingClientRect();
  page.scrollTop += rect.top - page.getBoundingClientRect().top - JUMP_MARGIN;
}

export function rectIn(box: HTMLElement, rects: readonly DOMRect[]): { top: number; bottom: number; left: number } {
  const base = box.getBoundingClientRect();
  const first = rects[0];
  const last = rects.at(-1);
  if (first === undefined || last === undefined) {
    return { top: 0, bottom: 0, left: 0 };
  }
  return { top: first.top - base.top, bottom: last.bottom - base.top, left: first.left - base.left };
}

export function rangeRects(range: Range): DOMRect[] {
  return typeof range.getClientRects === 'function' ? [...range.getClientRects()] : [];
}

export function elementRects(element: Element): DOMRect[] {
  return [...element.getClientRects()];
}
