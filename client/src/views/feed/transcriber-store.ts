import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../state/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { TranscriberStatus } from '../../api/shared.ts';
import { Store } from '../../state/store.ts';

export interface TranscriberState {
  status: TranscriberStatus | null;
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

  async load(): Promise<void> {
    try {
      const { status } = await this.#api.feed.transcriber();
      this.state.set((state) => ({ ...state, status }));
    } catch (cause) {
      console.warn('本地转写的状态没读到', cause);
    }
  }

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
