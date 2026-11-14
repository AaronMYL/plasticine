// 本地转写装没装（第13批）：抖音收藏的安装卡和设置 · AI 那一行共用。打开着时跟着服务端推的进度走（transcriber.changed）。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { TranscriberStatus } from '../../api/shared.ts';
import { Store } from '../../state/store.ts';

export interface TranscriberState {
  /** 还没读到是 null。 */
  status: TranscriberStatus | null;
  /** 点安装没成（请求没发出去、服务端拒了）；装的过程中出的错在 status.error。 */
  error: string | null;
}

export class TranscriberStore {
  readonly state = new Store<TranscriberState>({ status: null, error: null });
  readonly #api: PlasticineApi;
  readonly #hub: EventsHub;
  #opens = 0;
  #stop: (() => void) | null = null;

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.#api = api;
    this.#hub = hub;
  }

  /** 打开：读一次，开着时跟着进度走。返回关掉的函数。 */
  open(): () => void {
    this.#opens += 1;
    this.#stop ??= this.#hub.on((event) => {
      if (event.type === 'transcriber.changed') this.state.set((state) => ({ ...state, status: event.status }));
    });
    void this.load();
    return () => {
      this.#opens = Math.max(0, this.#opens - 1);
      if (this.#opens > 0) return;
      this.#stop?.();
      this.#stop = null;
    };
  }

  /** 读不到不打扰：卡片和那一行就先不出。 */
  async load(): Promise<void> {
    try {
      const { status } = await this.#api.feed.transcriber();
      this.state.set((state) => ({ ...state, status }));
    } catch (cause) {
      console.warn('本地转写的状态没读到', cause);
    }
  }

  /** 在后台装（进度跟着事件走）；then 是装的请求发出去以后接着做的（比如处理这一条）。 */
  async install(then?: () => Promise<void>): Promise<void> {
    this.state.set((state) => ({ ...state, error: null }));
    try {
      const { status } = await this.#api.feed.installTranscriber({ requestId: createRequestId() });
      this.state.set((state) => ({ ...state, status }));
      await then?.();
    } catch (cause) {
      this.state.set((state) => ({ ...state, error: errorText(cause) }));
    }
  }
}
