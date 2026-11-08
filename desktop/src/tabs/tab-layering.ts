// 网页标签的视图叠在哪一层、鼠标给谁（Mac 壳 ChromeHitRouter 的 Electron 版，纯逻辑，界面 preload 和主进程共用）。
// Electron 的视图不能按区域穿透点击，所以分两种摆法：
// - 界面没报 hitRegions（旧界面），或报了但没有一块浮层压在网页标签上：网页标签视图放在界面上面，鼠标、键盘、光标、
//   拖放全是原生的，最顺。
// - 有浮层（对话框、圆球、菜单）压在网页标签上：网页标签视图垫到界面下面（界面在那一块不画底色，网页照样看得见、
//   照样在动），落在浮层里的点给界面；落在网页标签那一块、不在浮层里的点由界面 preload 截下，经主进程用
//   sendInputEvent 转给网页标签（点、拖选、滚轮、右键），光标形状跟着网页标签报的换。

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

/** 网页标签垫在下面时，这个点要不要转给网页标签（在网页标签那一块、不在任何浮层里）。 */
export function forwardsToTab(x: number, y: number, frame: WebTabFrame | null,
  hitRegions: readonly WebTabFrame[] | undefined): boolean {
  if (frame === null || tabLayer(frame, hitRegions) === 'above') {
    return false;
  }
  return contains(frame, x, y) && !(hitRegions ?? []).some((region) => contains(region, x, y));
}

/** 视图的像素边界（取整，宽高不小于 0）。 */
export function viewBounds(frame: WebTabFrame): { x: number; y: number; width: number; height: number } {
  const x = Math.round(frame.x);
  const y = Math.round(frame.y);
  return { x, y, width: Math.max(0, Math.round(frame.x + frame.width) - x),
    height: Math.max(0, Math.round(frame.y + frame.height) - y) };
}
