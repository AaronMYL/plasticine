// 网页里的 window.open 哪些开成小窗口、开多大放哪（纯逻辑；窗口本身在 tab-popups.ts）。照 Chrome：带了窗口尺寸 / 是弹窗
// 的开小窗口，其余（target=_blank 链接、不带参数的 window.open）照旧开成标签。

import type { Rectangle } from 'electron';

/** 没给大小时的默认尺寸（常见登录弹窗的大小）。 */
const DEFAULT_SIZE = { width: 500, height: 600 };
/** 最小 100 × 100：和浏览器对 window.open 尺寸的下限一样。 */
const MIN_SIZE = 100;

export interface OpenRequest {
  url: string;
  disposition: string;
  features: string;
}

export function isWeb(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function feature(features: string, names: readonly string[]): number | null {
  for (const name of names) {
    const match = new RegExp(`(?:^|[\\s,])${name}\\s*=\\s*(\\d+)`, 'i').exec(features);
    if (match !== null) {
      return Number(match[1]);
    }
  }
  return null;
}

/** features 里要的窗口内容大小；没写是 null。 */
export function popupSize(features: string): { width: number | null; height: number | null } {
  return { width: feature(features, ['width', 'innerWidth']), height: feature(features, ['height', 'innerHeight']) };
}

/**
 * 要不要开成小窗口：Chromium 认作弹窗的 window.open（Electron 报 disposition 'new-window'）且带了 features，
 * 或者 features 里给了尺寸。按住 Shift 点链接也是 'new-window'，但没有 features，照旧开成标签。
 */
export function isPopupRequest(request: OpenRequest): boolean {
  if (!isWeb(request.url) && request.url !== 'about:blank' && request.url !== '') {
    return false;
  }
  const size = popupSize(request.features);
  return (request.disposition === 'new-window' && request.features.trim() !== '')
    || size.width !== null || size.height !== null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** 小窗口的位置大小：居中在主窗口上，压在屏幕可用区域里。 */
export function popupBounds(size: { width: number | null; height: number | null }, parent: Rectangle,
  workArea: Rectangle): Rectangle {
  const width = clamp(size.width ?? DEFAULT_SIZE.width, MIN_SIZE, workArea.width);
  const height = clamp(size.height ?? DEFAULT_SIZE.height, MIN_SIZE, workArea.height);
  const x = Math.round(parent.x + (parent.width - width) / 2);
  const y = Math.round(parent.y + (parent.height - height) / 2);
  return { x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height), width, height };
}
