// 资料库里改了什么（改名、删除、还原）：第二栏、资料库首页、订阅页、「最近删除」各自读接口，这里一个计数，谁改了就加一，
// 大家跟着重读。服务端不为空间发事件，本机改的这样就够；别处改的等下一次 resync。

import { invalidateQueries } from '../../state/live-query.ts';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';

const revision = new Store(0);

/** 资料库、图书、空间、订阅这些页面共用的缓存（state/live-query.ts）的 key 都以这些开头。 */
const LIBRARY_KEYS = ['library.', 'spaces.', 'subscriptions.', 'books.'];

export function libraryChanged(): void {
  revision.set((value) => value + 1);
  invalidateQueries((key) => LIBRARY_KEYS.some((prefix) => key.startsWith(prefix)));
}

export function useLibraryRevision(): number {
  return useStore(revision);
}
