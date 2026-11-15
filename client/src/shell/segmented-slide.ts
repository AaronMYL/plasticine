// 分段控件换一项时底块滑过去（11-15 动效一套，设计稿 19「切换」：分段的底块滑 180）。全站的分段都是同一种标记
// （.segmented > .segmented-item，选中的那一项 aria-pressed / aria-current），选中的底块画在 ::before 上；这里看着
// 选中换了哪一项，让新那一项的底块从旧那一项的位置和宽度滑过来。减少动态效果时不滑，直接换。

import { EASE_OUT, MOTION } from './motion.ts';

const PRESSED = ['aria-pressed', 'aria-current'] as const;

function pressed(element: Element): boolean {
  return element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-current') === 'page';
}

/** 新那一项的底块从旧那一项那里滑过来。 */
export function slideBetween(from: HTMLElement, to: HTMLElement): void {
  if (typeof to.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return;
  const old = from.getBoundingClientRect();
  const next = to.getBoundingClientRect();
  if (next.width === 0 || old.width === 0) return;
  to.animate([
    { transform: `translateX(${old.left - next.left}px) scaleX(${old.width / next.width})` },
    { transform: 'none' },
  ], { duration: MOTION.base, easing: EASE_OUT, pseudoElement: '::before' });
}

/** 看着整个页面的分段控件；返回停止的函数。 */
export function watchSegmented(root: HTMLElement): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const observer = new MutationObserver((records) => {
    const lost = new Map<Element, HTMLElement>();
    const gained = new Map<Element, HTMLElement>();
    for (const record of records) {
      const item = record.target;
      if (!(item instanceof HTMLElement) || !item.classList.contains('segmented-item')) continue;
      const group = item.closest('.segmented');
      if (group === null) continue;
      const was = record.attributeName === 'aria-current' ? record.oldValue === 'page' : record.oldValue === 'true';
      if (was && !pressed(item)) lost.set(group, item);
      if (!was && pressed(item)) gained.set(group, item);
    }
    for (const [group, to] of gained) {
      const from = lost.get(group);
      if (from !== undefined && from !== to) slideBetween(from, to);
    }
  });
  observer.observe(root, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: [...PRESSED] });
  return () => observer.disconnect();
}
