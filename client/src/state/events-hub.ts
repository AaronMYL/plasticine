import type { EventsApi } from '../api/client.ts';
import type { ConnectionStatus, LiveEvent } from '../api/types.ts';
import { Store } from './store.ts';

const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;

export type EventListener = (event: LiveEvent) => void;

export class EventsHub {
  readonly status = new Store<ConnectionStatus>('closed');
  private readonly listeners = new Set<EventListener>();
  private readonly events: EventsApi;
  private controller: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = RETRY_FIRST_MS;

  constructor(events: EventsApi) {
    this.events = events;
  }

  start(): void {
    if (this.controller !== null) {
      return;
    }
    this.connect(false);
  }

  stop(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const controller = this.controller;
    this.controller = null;
    controller?.abort();
    this.status.set('closed');
  }

  reconnect(): void {
    if (this.controller === null) {
      return;
    }
    const controller = this.controller;
    controller.abort();
    this.connect(true);
  }

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private dispatch(event: LiveEvent): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  private connect(reconnect: boolean): void {
    const controller = new AbortController();
    this.controller = controller;
    let catchUp = reconnect && !this.events.resumable();
    this.events.subscribe(
      {
        onEvent: (event) => this.dispatch(event),
        onStatus: (status) => {
          if (this.controller !== controller) {
            return;
          }
          this.status.set(status);
          if (status === 'open') {
            this.retryMs = RETRY_FIRST_MS;
            if (catchUp) {
              catchUp = false;
              this.dispatch({ type: 'resync' });
            }
          } else if (status === 'closed') {
            this.scheduleRetry();
          }
        },
      },
      controller.signal,
    );
  }

  private scheduleRetry(): void {
    this.controller = null;
    const wait = this.retryMs;
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(true);
    }, wait);
  }
}
