// 资料库的地址（2026-11-08 他定）：#/library 是资料库首页（空间列表）、#/library/sub/<订阅 id> 是一个订阅（页头 + 往期）、
// #/library/trash 是「最近删除」。单个空间仍是 #/books/space/<id>（链接太多，不改）。routes.ts 的 parseHash / routeHash
// 遇到 library 交给这里。

import type { Route } from './routes.ts';

const SUB_SEGMENT = 'sub';
const TRASH_SEGMENT = 'trash';

/** 资料库首页。 */
export const LIBRARY_HOME: Route = { view: 'library', noteId: null };

/** 一个订阅的页（个人回顾是 sub-review）。 */
export function subscriptionRoute(subscriptionId: string): Route {
  return { view: 'library', noteId: null, subscriptionId };
}

/** 「最近删除」。 */
export const LIBRARY_TRASH: Route = { view: 'library', noteId: null, libraryTrash: true };

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

/** #/library[/sub/<id> | /trash]：认不得的段、解不开的 id 都回资料库首页。 */
export function parseLibraryHash(segment: string | undefined, id: string | undefined): Route {
  if (segment === TRASH_SEGMENT) {
    return LIBRARY_TRASH;
  }
  if (segment === SUB_SEGMENT && id !== undefined) {
    const subscriptionId = decoded(id);
    return subscriptionId === null ? LIBRARY_HOME : subscriptionRoute(subscriptionId);
  }
  return LIBRARY_HOME;
}

export function libraryHash(route: Route): string {
  if (route.libraryTrash === true) {
    return `#/library/${TRASH_SEGMENT}`;
  }
  if (route.subscriptionId != null) {
    return `#/library/${SUB_SEGMENT}/${encodeURIComponent(route.subscriptionId)}`;
  }
  return '#/library';
}
