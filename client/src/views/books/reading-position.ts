// 打开一本书从哪读起，要不要提示「iPhone 上读到卷二 · 42%（今天 08:12）」。
// 进度是后写的为准（服务端不报冲突）；这台设备自己记着上次读到哪，别的设备更晚、更靠后时才提示，跳不跳由你。

import type { BookProgressView } from '../../api/shared.ts';
import type { BookRoutePosition } from '../../shell/routes.ts';
import type { LocalPosition } from './reader-prefs.ts';

export interface ReadingPosition {
  chapter: number;
  offset: number;
}

export function isAfter(a: ReadingPosition, b: ReadingPosition): boolean {
  return a.chapter > b.chapter || a.chapter === b.chapter && a.offset > b.offset;
}

/** 从哪读起：地址里带了位置就去那儿；这台设备读过就接着这台的；没读过用服务端记的；都没有从头。 */
export function startPosition(route: BookRoutePosition | null, local: LocalPosition | null,
  server: BookProgressView | null): ReadingPosition {
  if (route !== null) {
    return route;
  }
  if (local !== null) {
    return { chapter: local.chapter, offset: local.offset };
  }
  return server === null ? { chapter: 0, offset: 0 } : { chapter: server.chapter, offset: server.offset };
}

/** 别的设备在这台之后读、读得更靠后：返回那一条进度给横幅；否则 null。 */
export function otherDeviceAhead(server: BookProgressView | null, local: LocalPosition | null,
  deviceLabel: string): BookProgressView | null {
  if (server === null || local === null || server.deviceLabel === deviceLabel) {
    return null;
  }
  if (Date.parse(server.updatedAt) <= Date.parse(local.savedAt)) {
    return null;
  }
  return isAfter(server, local) ? server : null;
}
