// 抖音收藏的勾选清单（《优化清单》第 9 条，设计稿 Feed-Douyin）：列表（按收藏夹、标题和作者搜，按页往下读）、
// 他勾选的几条、同步（排给 Mac）、处理选中的。打开着时服务端说「变了」（video.changed）就重读，进度条跟着走。
// 勾选只在这台设备上：已经要处理过的（want = full）一开始就勾着。

import type { DouyinListResponse, VideoWorkView } from '../../api/shared.ts';
import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import { Store } from '../../state/store.ts';

/** 一页读多少条（一屏七八条，往下滚再读）。 */
export const DOUYIN_PAGE = 50;

export interface DouyinState {
  status: 'idle' | 'loading' | 'ready';
  data: DouyinListResponse | null;
  works: VideoWorkView[];
  error: string | null;
  folder: string | null;
  query: string;
  selected: ReadonlySet<string>;
  busy: 'sync' | 'process' | 'more' | null;
  /** 刚做完一件事的一句话（「排上了 3 条」）。 */
  notice: string | null;
}

const INITIAL: DouyinState = { status: 'idle', data: null, works: [], error: null, folder: null, query: '',
  selected: new Set(), busy: null, notice: null };

export class DouyinStore {
  readonly state = new Store<DouyinState>(INITIAL);
  readonly #api: PlasticineApi;
  readonly #hub: EventsHub;
  #stop: (() => void) | null = null;
  #controller: AbortController | null = null;

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.#api = api;
    this.#hub = hub;
  }

  /** 打开清单：读第一页，开着时跟着服务端的变化重读。 */
  open(): void {
    this.#stop ??= this.#hub.on((event) => {
      if (event.type === 'video.changed') {
        void this.load(false);
      }
    });
    void this.load(true);
  }

  close(): void {
    this.#stop?.();
    this.#stop = null;
    this.#controller?.abort();
  }

  async load(fresh: boolean): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const { folder, query, works } = this.state.get();
    this.state.set((state) => ({ ...state, status: fresh ? 'loading' : state.status, error: null }));
    try {
      const limit = fresh ? DOUYIN_PAGE : Math.max(DOUYIN_PAGE, works.length);
      const data = await this.#api.feed.douyin({ limit, offset: 0, ...(folder === null ? {} : { folder }),
        ...(query.trim() === '' ? {} : { q: query.trim() }) }, controller.signal);
      this.state.set((state) => ({
        ...state, status: 'ready', data, works: data.works,
        selected: fresh && state.selected.size === 0
          ? new Set(data.works.filter((work) => work.want === 'full').map((work) => work.id)) : state.selected,
      }));
    } catch (cause) {
      if (controller.signal.aborted) {
        return;
      }
      this.state.set((state) => ({ ...state, status: 'ready', error: errorText(cause) }));
    }
  }

  async more(): Promise<void> {
    const { data, works, folder, query } = this.state.get();
    if (data?.nextOffset == null) {
      return;
    }
    this.state.set((state) => ({ ...state, busy: 'more' }));
    try {
      const next = await this.#api.feed.douyin({ limit: DOUYIN_PAGE, offset: works.length,
        ...(folder === null ? {} : { folder }), ...(query.trim() === '' ? {} : { q: query.trim() }) });
      this.state.set((state) => ({ ...state, data: next, works: [...state.works, ...next.works], busy: null }));
    } catch (cause) {
      this.state.set((state) => ({ ...state, busy: null, error: errorText(cause) }));
    }
  }

  setFolder(folder: string | null): void {
    this.state.set((state) => ({ ...state, folder }));
    void this.load(false);
  }

  setQuery(query: string): void {
    this.state.set((state) => ({ ...state, query }));
    void this.load(false);
  }

  toggle(id: string): void {
    this.state.set((state) => {
      const selected = new Set(state.selected);
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.add(id);
      }
      return { ...state, selected, notice: null };
    });
  }

  async sync(): Promise<void> {
    this.state.set((state) => ({ ...state, busy: 'sync', notice: null, error: null }));
    try {
      const { sync } = await this.#api.feed.douyinSync({ requestId: createRequestId() });
      this.state.set((state) => ({ ...state, busy: null,
        data: state.data === null ? null : { ...state.data, sync } }));
      await this.load(false);
    } catch (cause) {
      this.state.set((state) => ({ ...state, busy: null, error: errorText(cause) }));
    }
  }

  async process(): Promise<void> {
    const ids = [...this.state.get().selected];
    if (ids.length === 0) {
      return;
    }
    this.state.set((state) => ({ ...state, busy: 'process', notice: null, error: null }));
    try {
      const result = await this.#api.feed.douyinProcess({ requestId: createRequestId(), ids });
      this.state.set((state) => ({ ...state, busy: null,
        notice: result.queued === 0 ? '选中的都处理过了' : `排上了 ${result.queued} 条` }));
      await this.load(false);
    } catch (cause) {
      this.state.set((state) => ({ ...state, busy: null, error: errorText(cause) }));
    }
  }
}
