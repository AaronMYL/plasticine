import { errorText } from '../api/errors.ts';
import type { LiveEvent } from '../api/types.ts';

export const REFETCH_DELAY_MS = 250;

export interface SnapshotLoaderOptions<T> {
  fetch: () => Promise<T>;
  apply: (snapshot: T, replay: readonly LiveEvent[]) => void;
  fail: (message: string) => void;
  delayMs?: number;
}

export class SnapshotLoader<T> {
  private readonly options: SnapshotLoaderOptions<T>;
  private token = 0;
  private buffered: LiveEvent[] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: SnapshotLoaderOptions<T>) {
    this.options = options;
  }

  inFlight(): boolean {
    return this.buffered !== null;
  }

  note(event: LiveEvent): void {
    this.buffered?.push(event);
  }

  async load(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.token += 1;
    const token = this.token;
    const buffered: LiveEvent[] = [];
    this.buffered = buffered;
    try {
      const snapshot = await this.options.fetch();
      if (token === this.token && !this.stopped) {
        this.buffered = null;
        this.options.apply(snapshot, buffered);
      }
    } catch (cause) {
      if (token === this.token && !this.stopped) {
        this.options.fail(errorText(cause));
      }
    } finally {
      if (token === this.token) {
        this.buffered = null;
      }
    }
  }

  schedule(): void {
    if (this.timer !== null || this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load();
    }, this.options.delayMs ?? REFETCH_DELAY_MS);
  }

  restart(): void {
    this.stopped = false;
  }

  stop(): void {
    this.token += 1;
    this.stopped = true;
    this.buffered = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
