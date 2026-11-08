// 整个应用只开一条 SSE，在这里分发给各个视图；视图订阅这里，不各自连、不轮询（《实施方案》第 8 节）。
// 断线后按退避重连，连接状态给侧栏底部的连接点用。真实现里浏览器的 EventSource 先自己重连（带 Last-Event-ID），
// 它放弃了（报 closed）这里才重新订阅。
// 重新订阅接不上断开前的位置时（EventsApi.resumable() 是 false），连上之后这里补报一次 resync，让对话、笔记、
// 任务清单和卡重新拉一遍：断线期间完成的回复、变了的任务不会停在断线前的样子（review-followups adf44c1）。

import type { EventsApi } from './client.ts';
import type { ConnectionStatus, LiveEvent } from './types.ts';
import { Store } from '../state/store.ts';

/** 重连退避：1 秒起，翻倍，最多 30 秒（默认值，接真服务端后按断线记录再调）。 */
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

  /** reconnect：这是断线之后的重新订阅；接不上原来的位置就在连上时补报 resync。 */
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
