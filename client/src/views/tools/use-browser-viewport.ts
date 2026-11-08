import { useLayoutEffect, useState, type RefObject } from 'react';
import type { BrowserViewport } from '../../api/shared.ts';

// 拖动窗口、对话栏和软键盘都会改变可用区；停稳 300ms 再重设远端，初次测量立即发送。
const RESIZE_DELAY_MS = 300;
const MAX_CSS_SIZE = 4096;
const MAX_DPR = 2;
const FALLBACK_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };

export function useBrowserViewport(container: RefObject<HTMLDivElement | null>): BrowserViewport | null {
  const [viewport, setViewport] = useState<BrowserViewport | null>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (element === null) {
      return;
    }
    let current: BrowserViewport | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) {
        return;
      }
      const next = { width: Math.min(MAX_CSS_SIZE, Math.max(1, Math.round(width))),
        height: Math.min(MAX_CSS_SIZE, Math.max(1, Math.round(height))),
        deviceScaleFactor: Math.min(window.devicePixelRatio || 1, MAX_DPR) };
      clearTimeout(timer);
      if (next.width === current?.width && next.height === current.height
        && next.deviceScaleFactor === current.deviceScaleFactor) {
        return;
      }
      const update = (): void => {
        current = next;
        setViewport(next);
      };
      if (current === null) {
        update();
      } else {
        timer = setTimeout(update, RESIZE_DELAY_MS);
      }
    };
    const resized = (): void => {
      const rect = element.getBoundingClientRect();
      measure(rect.width, rect.height);
    };
    resized();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        measure(entry.contentRect.width, entry.contentRect.height);
      }
    });
    if (observer === null && current === null) {
      setViewport(FALLBACK_VIEWPORT);
    }
    observer?.observe(element);
    window.addEventListener('resize', resized);
    window.visualViewport?.addEventListener('resize', resized);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', resized);
      window.visualViewport?.removeEventListener('resize', resized);
    };
  }, [container]);
  return viewport;
}
