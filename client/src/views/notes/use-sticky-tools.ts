// 笔记工具栏固定在编辑区顶上（2026-11-05 第 9 条）：工具栏在 .note-pane 这个滚动容器里 position: sticky（notes.css），
// 这里只管「让开它」：量它的高度写进 .note-pane 的 scroll-padding-top（锚点跳转、查找定位、
// scrollIntoView 都停在工具栏下面），并把同一个高度交给 ProseMirror 的 scrollMargin（光标滚进视野时它自己算，
// 不认 scroll-padding）。工具栏收着（手机默认）或没在固定（写修改要求时）高度记 0。

import { useEffect, useState, type RefObject } from 'react';

/** 光标、定位停在工具栏下面再空这么多（间距档 8）。 */
const CLEARANCE = 8;
/** ProseMirror 默认的左右、下边距（5px），不变。 */
const SIDE = 5;

export interface ScrollMargin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** ProseMirror 每次滚动光标时现读 scrollMargin：给它一个固定的对象，高度变了改里面的数就行，不用重建编辑器。 */
export function useScrollMargin(): ScrollMargin {
  const [margin] = useState<ScrollMargin>(() => ({ top: CLEARANCE, bottom: SIDE, left: SIDE, right: SIDE }));
  return margin;
}

export function useStickyTools(bar: RefObject<HTMLElement | null>, margin: ScrollMargin, stuck: boolean): void {
  useEffect(() => {
    const element = bar.current;
    if (element === null) {
      return undefined;
    }
    const pane = element.closest<HTMLElement>('.note-pane');
    const apply = (): void => {
      // 写修改要求时工具栏不固定（note-ai.css）：那时也不用让。
      const sticky = stuck && window.getComputedStyle(element).position === 'sticky';
      const height = sticky ? element.offsetHeight : 0;
      margin.top = height + CLEARANCE;
      pane?.style.setProperty('scroll-padding-top', `${height + 8}px`);
    };
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      margin.top = CLEARANCE;
      pane?.style.removeProperty('scroll-padding-top');
    };
  }, [bar, margin, stuck]);
}
