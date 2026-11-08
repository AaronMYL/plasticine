// 正文滚动和下标：读到哪 = 视口顶上第一块（段落、标题、列表项）开头的下标；跳到某个下标 = 把那一字滚到视口顶下面一点。
// 只量块的位置，不逐字量，滚动时便宜。

import { rangeBetween, textOffset } from './text-offsets.ts';

const BLOCKS = 'p, h2, h3, h4, li, pre';
// 跳过去时那一行离视口顶留多少：一行半左右，看得到上文的尾巴。
const JUMP_MARGIN = 48;
// 块的底边离视口顶不到这么多，就当它已经读过去了。
const READ_PAST = 8;

export function offsetAtTop(root: HTMLElement, page: HTMLElement): number {
  if (page.scrollTop <= 0) {
    return 0;
  }
  // 滚到底了：这一章读完了，记在章末。
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

/** 选区或元素相对正文框（.bk-text）的位置，弹出菜单按它放在下面。 */
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
