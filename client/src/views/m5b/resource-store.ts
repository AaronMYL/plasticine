// 工具组几页（记账、专注、提醒、日历、站内信、文件、成果、浏览器、工具开关）共用的读法：打开那一页才拉，之后回来静默再拉一份；
// 读失败说原因、手里有一份就照常显示那一份；事件流来的一行按版本就地换（比手里旧的不换），合计、顺序会变的再拉一份校准；
// 拉的期间到的事件，换上快照后按版本再放一遍——旧快照盖不掉新事件（SnapshotLoader）。

import type { EventsHub } from '../../api/events-hub.ts';
import type { LiveEvent } from '../../api/types.ts';
import { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';
import { SnapshotLoader } from '../../state/snapshot-loader.ts';

export interface Resource<T> {
  status: LoadStatus;
  error: string | null;
  value: T | null;
}

/** What an event does to the copy in hand: a new value, and whether to fetch again to recalibrate. */
export interface Merge<T> {
  value: T;
  refetch: boolean;
}

export type Merger<T> = (value: T, event: LiveEvent) => Merge<T> | null;

/** Replaces the row with the same id when the incoming one is newer; adds it when `add` (then the caller refetches). */
export function replaceByVersion<R extends { id: string; version: number }>(
  rows: readonly R[],
  incoming: R,
): { rows: R[]; changed: boolean; known: boolean } {
  const index = rows.findIndex((row) => row.id === incoming.id);
  if (index < 0) {
    return { rows: [...rows], changed: false, known: false };
  }
  const current = rows[index];
  if (current !== undefined && current.version >= incoming.version) {
    return { rows: [...rows], changed: false, known: true };
  }
  const next = [...rows];
  next[index] = incoming;
  return { rows: next, changed: true, known: true };
}

export class ResourceStore<T> {
  readonly data = new Store<Resource<T>>({ status: 'idle', error: null, value: null });
  private readonly hub: EventsHub;
  private readonly merge: Merger<T>;
  private loader: SnapshotLoader<T>;
  private fetcher: () => Promise<T>;
  private stopListening: (() => void) | null = null;

  constructor(hub: EventsHub, fetch: () => Promise<T>, merge: Merger<T>) {
    this.hub = hub;
    this.merge = merge;
    this.fetcher = fetch;
    this.loader = this.newLoader();
  }

  start(): void {
    if (this.stopListening !== null) {
      return;
    }
    this.loader.restart();
    this.stopListening = this.hub.on((event) => this.onEvent(event));
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.loader.stop();
  }

  /**
   * The page opened: fetch the first time (or after a failure), refresh quietly otherwise. A load that stop() voided
   * leaves 'loading' with nothing on the way; fetch again then too.
   */
  open(): void {
    const { status } = this.data.get();
    const orphaned = status === 'loading' && !this.loader.inFlight();
    if (status === 'idle' || status === 'failed' || orphaned) {
      void this.reload();
    } else if (status === 'ready') {
      void this.loader.load();
    }
  }

  reload(): Promise<void> {
    this.data.set((data) => ({ ...data, status: data.value === null ? 'loading' : data.status, error: null }));
    return this.loader.load();
  }

  /** Another query (another month, another folder): what is in hand belongs to the old one and goes. */
  refetchWith(fetch: () => Promise<T>): Promise<void> {
    this.loader.stop();
    this.fetcher = fetch;
    this.loader = this.newLoader();
    this.data.set({ status: 'loading', error: null, value: null });
    return this.loader.load();
  }

  /** The same fetch with a changed query it reads itself (the month, the folder): start over. */
  reset(): Promise<void> {
    return this.refetchWith(this.fetcher);
  }

  /** A write's answer (or a 409's current): merged like an event would be. */
  apply(event: LiveEvent): void {
    const value = this.data.get().value;
    if (value === null) {
      return;
    }
    const merged = this.merge(value, event);
    if (merged === null) {
      return;
    }
    this.data.set((data) => ({ ...data, value: merged.value }));
    if (merged.refetch) {
      this.loader.schedule();
    }
  }

  private newLoader(): SnapshotLoader<T> {
    return new SnapshotLoader<T>({
      fetch: () => this.fetcher(),
      apply: (snapshot, replay) => this.applySnapshot(snapshot, replay),
      fail: (message) => this.data.set((data) => ({ ...data, status: 'failed', error: message })),
    });
  }

  private onEvent(event: LiveEvent): void {
    this.loader.note(event);
    if (this.data.get().status === 'idle') {
      return;
    }
    if (event.type === 'resync') {
      void this.reload();
      return;
    }
    this.apply(event);
  }

  private applySnapshot(snapshot: T, replay: readonly LiveEvent[]): void {
    let value = snapshot;
    let refetch = false;
    for (const event of replay) {
      const merged = this.merge(value, event);
      if (merged !== null) {
        value = merged.value;
        refetch ||= merged.refetch;
      }
    }
    this.data.set({ status: 'ready', error: null, value });
    if (refetch) {
      this.loader.schedule();
    }
  }
}
