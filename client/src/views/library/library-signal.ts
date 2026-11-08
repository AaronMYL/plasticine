// 资料库里改了什么（改名、删除、还原）：第二栏、资料库首页、订阅页、「最近删除」各自读接口，这里一个计数，谁改了就加一，
// 大家跟着重读。服务端不为空间发事件，本机改的这样就够；别处改的等下一次 resync。

import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';

const revision = new Store(0);

export function libraryChanged(): void {
  revision.set((value) => value + 1);
}

export function useLibraryRevision(): number {
  return useStore(revision);
}
