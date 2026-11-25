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
