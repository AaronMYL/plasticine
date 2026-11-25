import { useEffect, useState } from 'react';
import { HIT_REGIONS_MAX, type WebTabFrame } from '../api/shared.ts';

export const HIT_REGION_ATTRIBUTE = 'data-hit-region';

function overlaps(rect: WebTabFrame, frame: WebTabFrame): boolean {
  return rect.x < frame.x + frame.width && rect.x + rect.width > frame.x
    && rect.y < frame.y + frame.height && rect.y + rect.height > frame.y;
}

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

export function sameFrames(a: readonly WebTabFrame[], b: readonly WebTabFrame[]): boolean {
  return a.length === b.length && a.every((rect, index) => {
    const other = b[index]!;
    return rect.x === other.x && rect.y === other.y && rect.width === other.width && rect.height === other.height;
  });
}

const NONE: WebTabFrame[] = [];

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
  }, [key]);
  return frame === null ? NONE : regions;
}
