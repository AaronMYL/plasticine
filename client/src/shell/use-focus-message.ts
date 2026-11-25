import { useEffect, useRef, type RefObject } from 'react';
import './focus-message.css';

export const FOCUS_MAX_PAGES = 80;
export const FOCUS_FLASH_MS = 2400;

export interface FocusTarget {
  key: string;
  ready: boolean;
  busy: boolean;
  canLoadMore: boolean;
  loadMore: () => void;
  find: (root: HTMLElement) => HTMLElement | null;
}

export function useFocusMessage(scroller: RefObject<HTMLElement | null>, target: FocusTarget | null,
  onFocused: () => void): void {
  const done = useRef<string | null>(null);
  const pages = useRef(0);
  const flash = useRef<{ element: HTMLElement; timer: number } | null>(null);
  useEffect(() => {
    const root = scroller.current;
    if (target === null || root === null || done.current === target.key || !target.ready || target.busy) return;
    if (target.canLoadMore && pages.current < FOCUS_MAX_PAGES) {
      pages.current += 1;
      target.loadMore();
      return;
    }
    const element = target.find(root);
    done.current = target.key;
    pages.current = 0;
    if (element === null) return;
    onFocused();
    element.scrollIntoView({ block: 'center' });
    if (flash.current !== null) {
      window.clearTimeout(flash.current.timer);
      flash.current.element.classList.remove('is-focused');
    }
    element.classList.add('is-focused');
    flash.current = { element, timer: window.setTimeout(() => element.classList.remove('is-focused'), FOCUS_FLASH_MS) };
  });
  useEffect(() => () => {
    if (flash.current !== null) window.clearTimeout(flash.current.timer);
  }, []);
}

export function lineItemForSeq(root: HTMLElement, seq: number): HTMLElement | null {
  let after: HTMLElement | null = null;
  for (const element of root.querySelectorAll<HTMLElement>('[data-seq-from]')) {
    const from = Number(element.dataset['seqFrom']);
    const to = Number(element.dataset['seqTo'] ?? from);
    if (from <= seq && seq <= to) return element;
    if (from > seq && after === null) after = element;
  }
  return after;
}
