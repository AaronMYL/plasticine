import { useEffect, useState, type RefObject } from 'react';

const CLEARANCE = 8;
const SIDE = 5;

export interface ScrollMargin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

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
