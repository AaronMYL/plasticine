import type { WebTabFrame } from '../../../agent/shared/api/mac-bridge.ts';

export type TabLayer = 'above' | 'below';

export function contains(rect: WebTabFrame, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

export function intersects(a: WebTabFrame, b: WebTabFrame): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    && a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0;
}

export function tabLayer(frame: WebTabFrame | null, hitRegions: readonly WebTabFrame[] | undefined): TabLayer {
  if (frame === null || hitRegions === undefined) {
    return 'above';
  }
  return hitRegions.some((region) => intersects(region, frame)) ? 'below' : 'above';
}

export function forwardsToTab(x: number, y: number, frame: WebTabFrame | null,
  hitRegions: readonly WebTabFrame[] | undefined): boolean {
  if (frame === null || tabLayer(frame, hitRegions) === 'above') {
    return false;
  }
  return contains(frame, x, y) && !(hitRegions ?? []).some((region) => contains(region, x, y));
}

export function restackIndex<T>(children: readonly T[], ui: T, tab: T, layer: TabLayer): number | null {
  const uiIndex = children.indexOf(ui);
  const tabIndex = children.indexOf(tab);
  if (uiIndex < 0) {
    return null;
  }
  if (layer === 'above') {
    return tabIndex > uiIndex ? null : children.length;
  }
  if (tabIndex >= 0 && tabIndex < uiIndex) {
    return null;
  }
  return uiIndex;
}

export function viewBounds(frame: WebTabFrame): { x: number; y: number; width: number; height: number } {
  const x = Math.round(frame.x);
  const y = Math.round(frame.y);
  return { x, y, width: Math.max(0, Math.round(frame.x + frame.width) - x),
    height: Math.max(0, Math.round(frame.y + frame.height) - y) };
}

export const HIDDEN_TAB_SIZE = { width: 1280, height: 800 } as const;

export function hiddenBounds(frame: WebTabFrame | null): { x: number; y: number; width: number; height: number } {
  if (frame !== null && frame.width > 0 && frame.height > 0) {
    return viewBounds(frame);
  }
  return { x: 0, y: 0, ...HIDDEN_TAB_SIZE };
}
