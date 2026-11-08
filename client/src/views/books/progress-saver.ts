// 阅读进度往服务端存：翻动停下约 2 秒存一次；切走标签页、关页面（pagehide / visibilitychange）立刻存。
// 这台设备自己的位置每次都先记进 localStorage，下次打开从这里接着读；服务端那份给别的设备看。

import type { BooksApi } from '../../api/books-client.ts';
import { errorText } from '../../api/errors.ts';
import { Store } from '../../state/store.ts';
import { saveLocalPosition } from './reader-prefs.ts';
import type { ReadingPosition } from './reading-position.ts';

/** 停下多久存一次：2 秒（任务书「debounced ~2 s」），翻页时不至于每一屏都打一次接口。 */
export const PROGRESS_SAVE_DELAY_MS = 2_000;

export type SyncState = { status: 'saved' } | { status: 'pending' } | { status: 'failed'; error: string };

export interface ProgressPoint extends ReadingPosition {
  percent: number;
}

export class ProgressSaver {
  readonly state = new Store<SyncState>({ status: 'saved' });
  private readonly api: BooksApi;
  private readonly bookId: string;
  private readonly deviceLabel: string;
  private latest: ProgressPoint | null = null;
  private saved: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(api: BooksApi, bookId: string, deviceLabel: string) {
    this.api = api;
    this.bookId = bookId;
    this.deviceLabel = deviceLabel;
  }

  /** 记下读到哪：本机马上记，服务端停下 2 秒再存。 */
  update(point: ProgressPoint, now: Date = new Date()): void {
    const key = `${point.chapter}:${point.offset}`;
    saveLocalPosition(this.bookId, { ...point, savedAt: now.toISOString() });
    if (key === this.saved && this.timer === undefined) {
      return;
    }
    this.latest = point;
    this.state.set({ status: 'pending' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), PROGRESS_SAVE_DELAY_MS);
  }

  /** 还没存的那一次现在就存（切走、关页面、离开阅读页时）。 */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const point = this.latest;
    if (point === null) {
      return;
    }
    this.latest = null;
    try {
      await this.api.saveProgress(this.bookId, { chapter: point.chapter, offset: point.offset,
        percent: point.percent, deviceLabel: this.deviceLabel });
      this.saved = `${point.chapter}:${point.offset}`;
      if (this.latest === null) {
        this.state.set({ status: 'saved' });
      }
    } catch (error) {
      // 进度没存上不打断阅读：下次翻动会再存；本机的位置已经记下了。
      this.latest ??= point;
      this.state.set({ status: 'failed', error: errorText(error) });
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
