// 拉一份整的（任务清单、卡）和事件流怎么对上：拉的时候事件照常到、照常就地改；拉回来的那一份换上之后，把拉的
// 这段时间里到的事件按版本再放一遍，旧快照盖不掉新事件（review-followups af11488 说的就是对话这里的毛病）。
// 事件让顺序可能变了（换区、新卡、卡答掉了）时不自己猜服务端怎么排，隔一小会儿再拉一份（几条事件挨着到只拉一次）。

import { errorText } from '../api/errors.ts';
import type { LiveEvent } from '../api/types.ts';

/** 事件之后隔多久再拉一份：250 毫秒，够把一次作答带来的几条事件攒到一起（默认值，接真服务端后按实测再调）。 */
export const REFETCH_DELAY_MS = 250;

export interface SnapshotLoaderOptions<T> {
  fetch: () => Promise<T>;
  /** 拉回来了：换上它，再按顺序放一遍拉的期间到的事件。 */
  apply: (snapshot: T, replay: readonly LiveEvent[]) => void;
  /** 没拉到：写一句给人看，手里的那一份留着。 */
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

  /** 有没有一次还会回来的拉取在路上（被 stop 作废的那次不算）。 */
  inFlight(): boolean {
    return this.buffered !== null;
  }

  /** 每条事件都过一下：正在拉的时候记下来，拉回来再放一遍。 */
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
        // 回放走和写回执同一入口；先结束收集，不能把回放再添回正在遍历的缓冲。
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

  /** 过一小会儿再拉一份；已经排着的就不再排。 */
  schedule(): void {
    if (this.timer !== null || this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load();
    }, this.options.delayMs ?? REFETCH_DELAY_MS);
  }

  /** 停过之后再用（StrictMode 下实时层会先停再起一次）。 */
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
