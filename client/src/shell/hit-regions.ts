// 盖在 Mac 原生网页标签上的浮层（2026-11-03，用户定「对话框盖在网页上」，Mac 0.3.0）：原生网页垫在主网页下面，
// 主网页在那一块透明；落在这些矩形里的点击交给主网页，其余交给网页标签（协议在 agent/shared/api/mac-bridge.ts）。
// 浮层自己在元素上标 data-hit-region（对话框、圆球、菜单、弹层……）；这里在网页标签显示时每帧量一次，
// 变了才报（拖对话框、改大小、展开收起的形变都跟得上）。

import { useEffect, useState } from 'react';
import { HIT_REGIONS_MAX, type WebTabFrame } from '../api/shared.ts';

/** 浮层在自己的根元素上写这个属性（值随意，便于调试时认出是谁）。 */
export const HIT_REGION_ATTRIBUTE = 'data-hit-region';

function overlaps(rect: WebTabFrame, frame: WebTabFrame): boolean {
  return rect.x < frame.x + frame.width && rect.x + rect.width > frame.x
    && rect.y < frame.y + frame.height && rect.y + rect.height > frame.y;
}

/** 现在压在网页标签那一块上的浮层矩形（CSS 像素，相对视口），最多 HIT_REGIONS_MAX 个。 */
export function collectHitRegions(root: ParentNode, frame: WebTabFrame): WebTabFrame[] {
  const regions: WebTabFrame[] = [];
  for (const element of root.querySelectorAll(`[${HIT_REGION_ATTRIBUTE}]`)) {
    const box = element.getBoundingClientRect();
    const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
    if (rect.width > 0 && rect.height > 0 && overlaps(rect, frame)) {
      regions.push(rect);
    }
  }
  return regions.slice(0, HIT_REGIONS_MAX);
}

/** 两组矩形一模一样（顺序也一样）：量出来没变就不再报给原生。 */
export function sameFrames(a: readonly WebTabFrame[], b: readonly WebTabFrame[]): boolean {
  return a.length === b.length && a.every((rect, index) => {
    const other = b[index]!;
    return rect.x === other.x && rect.y === other.y && rect.width === other.width && rect.height === other.height;
  });
}

const NONE: WebTabFrame[] = [];

/** 网页标签显示时（frame 不是 null）每帧量一次浮层；不显示时是空的。 */
export function useHitRegions(frame: WebTabFrame | null): WebTabFrame[] {
  const [regions, setRegions] = useState<WebTabFrame[]>(NONE);
  const key = frame === null ? null : `${frame.x},${frame.y},${frame.width},${frame.height}`;
  useEffect(() => {
    if (frame === null) {
      setRegions(NONE);
      return undefined;
    }
    const measure = (): void => {
      const next = collectHitRegions(document, frame);
      setRegions((previous) => (sameFrames(previous, next) ? previous : next));
    };
    measure();
    if (typeof window.requestAnimationFrame !== 'function') {
      return undefined;
    }
    let handle = 0;
    const loop = (): void => {
      measure();
      handle = window.requestAnimationFrame(loop);
    };
    handle = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(handle);
    // frame 按值比较（key），同一个位置的新对象不重开循环。
  }, [key]);
  return frame === null ? NONE : regions;
}
