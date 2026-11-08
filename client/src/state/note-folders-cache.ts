// 笔记文件夹的共享读缓存（2026-11-05 第 10 条「切笔记时文件夹闪一下」）：切笔记时整个笔记页按路由重挂，
// 文件夹列表以前每次从空开始重拉，先画出「全部 0」、文件夹那组空着，拉回来再整列换上。现在列表放在这里：
// 挂上时先用上次的马上画，后台再核实；拉回来的和手上的一样就不换（订阅的组件不重画）。
// 按 api 实例分开（WeakMap）：测试和换会话各用各的，互不串。有人看着时才听 note.* / resync 事件。

import type { NotesApi } from '../api/client.ts';
import { errorText } from '../api/errors.ts';
import type { NoteFoldersView } from '../api/shared.ts';
import type { LiveEvent } from '../api/types.ts';
import { Store } from './store.ts';

type FoldersApi = Pick<NotesApi, 'folders'>;
type Hub = { on: (listener: (event: LiveEvent) => void) => () => void };

export interface NoteFoldersSnapshot {
  folders: NoteFoldersView | null;
  error: string | null;
}

const EMPTY: NoteFoldersSnapshot = { folders: null, error: null };

function sameFolders(a: NoteFoldersView | null, b: NoteFoldersView): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

export class NoteFoldersCache {
  readonly store = new Store<NoteFoldersSnapshot>(EMPTY);
  private readonly api: FoldersApi;
  private readers = 0;
  private flight: AbortController | null = null;
  private generation = 0;
  private off: (() => void) | null = null;

  constructor(api: FoldersApi) {
    this.api = api;
  }

  /** 有人在看：先给手上的，后台拉一次；第一个读者顺带订上事件。返回的函数是「不看了」。 */
  observe(hub: Hub): () => void {
    this.readers += 1;
    if (this.off === null) {
      this.off = hub.on((event) => {
        if (event.type.startsWith('note.') || event.type === 'resync') {
          void this.load();
        }
      });
    }
    void this.load();
    return () => {
      this.readers -= 1;
      if (this.readers > 0) {
        return;
      }
      this.off?.();
      this.off = null;
      this.flight?.abort();
      this.flight = null;
    };
  }

  /** 拉一次；后发的盖过先发的（先发的结果晚到也不用）。 */
  load(): Promise<void> {
    this.flight?.abort();
    const controller = new AbortController();
    this.flight = controller;
    const current = ++this.generation;
    return this.api.folders(controller.signal).then((folders) => {
      if (controller.signal.aborted || current !== this.generation) {
        return;
      }
      const previous = this.store.get();
      if (sameFolders(previous.folders, folders) && previous.error === null) {
        return;
      }
      this.store.set({ folders: sameFolders(previous.folders, folders) ? previous.folders : folders, error: null });
    }, (cause: unknown) => {
      if (controller.signal.aborted || current !== this.generation) {
        return;
      }
      // 读不到时保留上次的列表，只多一句出错原因和重试。
      this.store.set({ folders: this.store.get().folders, error: errorText(cause) });
    });
  }
}

const caches = new WeakMap<FoldersApi, NoteFoldersCache>();

export function noteFoldersCache(api: FoldersApi): NoteFoldersCache {
  let cache = caches.get(api);
  if (cache === undefined) {
    cache = new NoteFoldersCache(api);
    caches.set(api, cache);
  }
  return cache;
}
