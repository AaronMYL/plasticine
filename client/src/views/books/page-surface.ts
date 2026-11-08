// 翻页的 DOM 那一半（paginator.ts 的 PageSurface）：.bk-sheet 是一页宽的滚动容器（overflow 藏起来），里面的 .bk-text
// 是固定高度的多栏容器，一栏一页；栏宽、栏高、栏间距由这里按 .bk-sheet 的大小写成 CSS 变量（reader.css 用）。
// 翻页 = 改 .bk-sheet 的 scrollLeft（不用 transform，照 foliate-js），平移用 requestAnimationFrame 一帧帧改；
// 「减少动态效果」或没有 requestAnimationFrame 时直接换页。

import { MOTION, prefersReducedMotion } from '../../shell/motion.ts';
import { PAGE_GAP, type PageMetrics, type PageSurface } from './paginator.ts';
import { plainText, rangeBetween } from './text-offsets.ts';

/** 平移一页用多久：形变与补位那一档（--motion-slow 260）。 */
export const PAGE_TURN_MS = MOTION.slow;

/** 缓出：一开始快、停得轻（和 EASE_OUT 的感觉一样）。 */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

const running = new WeakMap<HTMLElement, number>();

/** 把 scroller 的 scrollLeft 平移到 to；同一个容器上新的一次会接替还没走完的那次。 */
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

/** 按这一页的大小写栏宽、栏高（插图最高一页）：.bk-text 的多栏跟着它们排。 */
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
      // 多栏容器跟着 scrollLeft 一起挪，字相对它的横坐标就是它在整条栏里的位置。
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
