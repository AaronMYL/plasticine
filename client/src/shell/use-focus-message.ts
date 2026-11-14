// 定位到一条消息（第13批：点通知、点来信里的原话都要落到那一句）。地址里带着要看的那一句时：那一句还没读到就往上
// 一页页读（最多 FOCUS_MAX_PAGES 页），读到了滚到中间、闪一下；那一句已经没有了（删了、对不上）就停在原处，不乱跳。
// Plasticine 的对话（线）和联系人、群组的聊天共用这一个。

import { useEffect, useRef, type RefObject } from 'react';
import './focus-message.css';

/** 往上最多读这么多页还没找到，就算了。 */
export const FOCUS_MAX_PAGES = 80;
/** 闪一下多久（和 .is-focused 的动画一样长）。 */
export const FOCUS_FLASH_MS = 2400;

export interface FocusTarget {
  /** 这一次要看的是哪一句（换了才再定位一次）。 */
  key: string;
  /** 第一页读好了没有。 */
  ready: boolean;
  /** 正在往上读：等它读完再看。 */
  busy: boolean;
  /** 要找的那一句比已经读到的都早、而且还能往上读：先读，读到了再找。 */
  canLoadMore: boolean;
  loadMore: () => void;
  /** 在滚动区里找那一句（找不到是 null）。 */
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

/** 线里的一项（一轮或一句）占着 data-seq-from…data-seq-to：找含这个序号的那项；没有就找它后面最近的一项。 */
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
