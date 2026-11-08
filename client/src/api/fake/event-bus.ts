// 假的 SSE：同一进程里的订阅表。订阅时先报 connecting 再报 open，和真实连接的顺序一致。
// 推的是客户端的实时事件（message.* / note.* / task.* / ask.* / resync），不经服务端事件的映射。
// 断线期间的事件不补发（resumable 是 false），EventsHub 重连上之后自己报 resync。

import type { EventsApi } from '../client.ts';
import type { EventHandlers, LiveEvent } from '../types.ts';

export class FakeEventBus implements EventsApi {
  private readonly subscribers = new Set<EventHandlers>();
  /** 模拟「连不上」：订阅只报 connecting 再报 closed，直到改回 false。测连接横幅和重连用。 */
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

  /** 模拟断线：所有订阅者收到 closed，订阅表清空。 */
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
