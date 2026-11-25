import type { BooksApi } from '../../api/books-client.ts';
import { errorText } from '../../api/errors.ts';
import { Store } from '../../state/store.ts';
import { saveLocalPosition } from './reader-prefs.ts';
import type { ReadingPosition } from './reading-position.ts';

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
      this.latest ??= point;
      this.state.set({ status: 'failed', error: errorText(error) });
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
