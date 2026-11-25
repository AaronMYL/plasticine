import type { EventsApi } from '../client.ts';
import type { EventHandlers, LiveEvent } from '../types.ts';

export class FakeEventBus implements EventsApi {
  private readonly subscribers = new Set<EventHandlers>();
  offline = false;

  subscribe(handlers: EventHandlers, signal?: AbortSignal): () => void {
    this.subscribers.add(handlers);
    handlers.onStatus('connecting');
    queueMicrotask(() => {
      if (!this.subscribers.has(handlers)) {
        return;
      }
      if (this.offline) {
        this.subscribers.delete(handlers);
        handlers.onStatus('closed');
        return;
      }
      handlers.onStatus('open');
    });
    const unsubscribe = (): void => {
      if (this.subscribers.delete(handlers)) {
        handlers.onStatus('closed');
      }
    };
    signal?.addEventListener('abort', unsubscribe, { once: true });
    return unsubscribe;
  }

  resumable(): boolean {
    return false;
  }

  emit(event: LiveEvent): void {
    for (const handlers of [...this.subscribers]) {
      handlers.onEvent(event);
    }
  }

  disconnectAll(): void {
    for (const handlers of [...this.subscribers]) {
      this.subscribers.delete(handlers);
      handlers.onStatus('closed');
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
