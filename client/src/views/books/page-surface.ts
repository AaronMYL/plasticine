import { MOTION, prefersReducedMotion } from '../../shell/motion.ts';
import { PAGE_GAP, type PageMetrics, type PageSurface } from './paginator.ts';
import { plainText, rangeBetween } from './text-offsets.ts';

export const PAGE_TURN_MS = MOTION.slow;

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

const running = new WeakMap<HTMLElement, number>();

export function slideTo(scroller: HTMLElement, to: number, duration: number): Promise<void> {
  const previous = running.get(scroller);
  if (previous !== undefined) {
    cancelAnimationFrame(previous);
    running.delete(scroller);
  }
  const from = scroller.scrollLeft;
  if (duration <= 0 || from === to || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    scroller.scrollLeft = to;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let start: number | null = null;
    const frame = (now: number): void => {
      start ??= now;
      const progress = Math.min(1, (now - start) / duration);
      scroller.scrollLeft = from + (to - from) * easeOut(progress);
      if (progress < 1) {
        running.set(scroller, requestAnimationFrame(frame));
      } else {
        running.delete(scroller);
        resolve();
      }
    };
    running.set(scroller, requestAnimationFrame(frame));
  });
}

export function sizeColumns(sheet: HTMLElement, text: HTMLElement): void {
  text.style.setProperty('--page-width', `${sheet.clientWidth}px`);
  text.style.setProperty('--page-height', `${sheet.clientHeight}px`);
  text.style.setProperty('--page-gap', `${PAGE_GAP}px`);
}

export function domSurface(sheet: HTMLElement, text: HTMLElement, root: () => HTMLElement | null): PageSurface {
  return {
    measure(): PageMetrics {
      const width = sheet.clientWidth;
      const step = width + PAGE_GAP;
      if (width === 0) {
        return { step, pages: 1 };
      }
      return { step, pages: Math.max(1, Math.round((sheet.scrollWidth - width) / step) + 1) };
    },
    pageOf(offset: number): number | null {
      const content = root();
      const width = sheet.clientWidth;
      if (content === null || width === 0) {
        return null;
      }
      const range = rangeBetween(content, offset, offset + 1);
      if (range === null || typeof range.getClientRects !== 'function') {
        return null;
      }
      const rect = [...range.getClientRects()].find((item) => item.width > 0 || item.height > 0);
      if (rect === undefined) {
        return null;
      }
      const x = rect.left - text.getBoundingClientRect().left;
      return Math.max(0, Math.floor((x + 1) / (width + PAGE_GAP)));
    },
    length(): number {
      const content = root();
      return content === null ? 0 : plainText(content).length;
    },
    show(page: number, step: number, animate: boolean): Promise<void> {
      return slideTo(sheet, page * step, animate ? PAGE_TURN_MS : 0);
    },
  };
}
