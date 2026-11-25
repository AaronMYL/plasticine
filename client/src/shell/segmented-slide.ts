import { EASE_OUT, MOTION } from './motion.ts';

const PRESSED = ['aria-pressed', 'aria-current'] as const;

function pressed(element: Element): boolean {
  return element.getAttribute('aria-pressed') === 'true' || element.getAttribute('aria-current') === 'page';
}

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
