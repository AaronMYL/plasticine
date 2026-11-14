import { compareFeedItems, type FeedComment, type FeedCommentsResponse } from '../../api/shared.ts';
import { FeedRefreshTracker } from './feed-refresh.ts';
// 信息流页的数据：条目（按天新的在前、同一天里命中关注点的在前，shared/feed-order.ts；不感兴趣的默认藏起来，可只看
// 收藏）、往后翻、信息源。第一次打开信息流才拉，之后回来静默再拉一份。事件流来的一条按版本就地换；点了「不感兴趣」的
// （没开「连不感兴趣的一起看」时）、只看收藏时取消收藏的，从列表里收走，展开状态一起清掉。
// 这次在页上刚点了「不感兴趣」的（feedUi 的 dismissedIds，11-04）先就地留着、卡片收成可撤销的占位；重拉的快照里没有它
// 也照留，离开这一页、换分段时（settleDismissed）才收走。
// 拉的期间到的事件，换上快照后按版本再放一遍：旧快照盖不掉新事件。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import type {
  FeedItemView,
  FeedListQuery,
  FeedListResponse,
  FeedSourcesResponse,
  FeedSourceView,
  LiveEvent,
} from '../../api/types.ts';
import type { FeedSegment, FeedUi } from '../../state/feed-ui.ts';
import { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';
import { SnapshotLoader } from '../../state/snapshot-loader.ts';
import { deviceTimeZone as localTimeZone } from '../../state/time-zone.ts';

export interface FeedData {
  status: LoadStatus;
  error: string | null;
  items: readonly FeedItemView[];
  nextOffset: number | null;
  newToday: number;
  loadingMore: boolean;
  moreError: string | null;
}

export interface SourcesData {
  status: LoadStatus;
  error: string | null;
  sources: FeedSourcesResponse | null;
}

const EMPTY_FEED: FeedData = {
  status: 'idle',
  error: null,
  items: [],
  nextOffset: null,
  newToday: 0,
  loadingMore: false,
  moreError: null,
};

export class FeedStore {
  readonly data = new Store<FeedData>(EMPTY_FEED);
  readonly refresh: FeedRefreshTracker;
  readonly comments = new Store<ReadonlyMap<string, readonly FeedComment[]>>(new Map());
  readonly sources = new Store<SourcesData>({ status: 'idle', error: null, sources: null });
  private readonly api: PlasticineApi;
  private readonly hub: EventsHub;
  private readonly ui: FeedUi;
  private timeZone: string;
  private readonly loader: SnapshotLoader<FeedListResponse>;
  private readonly versions = new Map<string, number>();
  private readonly sourceRows = new Map<string, FeedSourceView>();
  /** 各分段上次看到的样子：切回来先画它，后台再拉。 */
  private readonly segmentCache = new Map<FeedSegment, FeedData>();
  private pageGeneration = 0;
  private sourcesGeneration = 0;
  private paginationDirty = false;
  private snapshotPending = false;
  private stopListening: (() => void) | null = null;

  constructor(api: PlasticineApi, hub: EventsHub, ui: FeedUi, timeZone: string = localTimeZone()) {
    this.api = api;
    this.refresh = new FeedRefreshTracker(api.feed, async () => {
      await this.reload();
      await this.loadSources();
    });
    this.hub = hub;
    this.ui = ui;
    this.timeZone = timeZone;
    this.loader = new SnapshotLoader({
      fetch: () => {
        this.pageGeneration += 1;
        this.paginationDirty = false;
        this.snapshotPending = true;
        this.data.set((data) => ({ ...data, loadingMore: data.nextOffset !== null }));
        return this.api.feed.list(this.query(0));
      },
      apply: (snapshot, replay) => this.applySnapshot(snapshot, replay),
      fail: (message) => {
        this.snapshotPending = false;
        this.data.set((data) => ({ ...data, status: 'failed', error: message, loadingMore: false }));
      },
    });
  }

  start(): void {
    if (this.stopListening !== null) {
      return;
    }
    this.loader.restart();
    this.stopListening = this.hub.on((event) => this.onEvent(event));
  }

  stop(): void {
    this.refresh.stop();
    this.stopListening?.();
    this.stopListening = null;
    this.loader.stop();
    this.pageGeneration += 1;
    this.sourcesGeneration += 1;
    this.sources.set((data) => ({ ...data, status: data.status === 'loading' ? 'idle' : data.status }));
    this.data.set((data) => ({ ...data, status: data.status === 'loading' ? 'idle' : data.status }));
  }

  /** 信息流页打开时调。 */
  open(): void {
    const { status } = this.data.get();
    if (status === 'idle' || status === 'failed') {
      void this.reload();
    } else if (status === 'ready') {
      void this.loader.load();
    }
    const sources = this.sources.get().status;
    if (sources !== 'loading') {
      void this.loadSources();
    }
  }

  reload(): Promise<void> {
    this.data.set((data) => ({ ...data, status: data.status === 'ready' ? 'ready' : 'loading', error: null }));
    return this.loader.load();
  }

  setTimeZone(timeZone: string): void {
    if (this.timeZone === timeZone) {
      return;
    }
    this.timeZone = timeZone;
    const opened = this.data.get().status !== 'idle';
    this.pageGeneration += 1;
    this.versions.clear();
    this.segmentCache.clear();
    this.loader.stop();
    this.loader.restart();
    this.data.set(EMPTY_FEED);
    if (opened) {
      void this.reload();
    }
  }

  /** 连不感兴趣的一起看 / 再藏起来：换了条件，整份重拉。 */
  setIncludeHidden(includeHidden: boolean): Promise<void> {
    this.settleDismissed();
    this.segmentCache.clear();
    this.ui.setIncludeHidden(includeHidden);
    return this.reload();
  }

  /** 只看收藏 / 看全部：换了条件，整份重拉。 */
  setSavedOnly(savedOnly: boolean): Promise<void> {
    this.settleDismissed();
    this.ui.setSavedOnly(savedOnly);
    return this.reload();
  }

  /** 第 3 批页头分段：换了就整份重拉。上一段的条目不留在屏上：这一段看过就先画上次的，没看过就先出占位（11-11 第 1 条）。 */
  setSegment(segment: FeedSegment): Promise<void> {
    const previous = this.ui.segment();
    if (previous === segment) { return Promise.resolve(); }
    this.settleDismissed();
    const current = this.data.get();
    if (current.status === 'ready') {
      this.segmentCache.set(previous, { ...current, loadingMore: false, moreError: null });
    }
    this.ui.setSegment(segment);
    this.pageGeneration += 1;
    this.data.set(this.segmentCache.get(segment) ?? { ...EMPTY_FEED, status: 'loading' });
    return this.reload();
  }

  async more(): Promise<void> {
    if (this.snapshotPending || this.data.get().status !== 'ready') {
      return;
    }
    if (this.paginationDirty) {
      await this.reload();
    }
    const current = this.data.get();
    if (this.paginationDirty || current.status !== 'ready' || current.nextOffset === null || current.loadingMore) {
      return;
    }
    this.data.set((data) => ({ ...data, loadingMore: true, moreError: null }));
    const generation = this.pageGeneration;
    try {
      const page = await this.api.feed.list(this.query(current.nextOffset));
      if (generation !== this.pageGeneration) {
        return;
      }
      for (const item of page.items) {
        if (this.accept(item)) {
          this.place(item);
        }
      }
      this.data.set((data) => ({ ...data, nextOffset: page.nextOffset, loadingMore: false }));
    } catch (cause) {
      if (generation === this.pageGeneration) {
        this.data.set((data) => ({ ...data, loadingMore: false, moreError: errorText(cause) }));
      }
    }
  }

  async loadSources(): Promise<void> {
    const generation = ++this.sourcesGeneration;
    this.sources.set((data) => ({ ...data, status: data.sources === null ? 'loading' : data.status, error: null }));
    try {
      const sources = await this.api.feed.sources();
      if (generation === this.sourcesGeneration) {
        for (const source of [...sources.interests, ...sources.blocked, ...sources.others]) {
          this.rememberSource(source);
        }
        this.sources.set({ status: 'ready', error: null, sources: this.groupSources(sources) });
      }
    } catch (cause) {
      if (generation === this.sourcesGeneration) {
        this.sources.set((data) => ({ ...data, status: 'failed', error: errorText(cause) }));
      }
    }
  }

  applyComments(id: string, response: FeedCommentsResponse): void {
    this.comments.set((threads) => {
      const rows = new Map((threads.get(id) ?? []).map((row) => [row.id, row]));
      for (const row of response.comments) {
        const known = rows.get(row.id);
        if (known === undefined || known.version < row.version) { rows.set(row.id, row); }
      }
      return new Map(threads).set(id, [...rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    });
  }

  /** 离开信息流页、换条件时调：可撤销的占位清掉，刚点了「不感兴趣」的那几条照规矩收走。 */
  settleDismissed(): void {
    if (this.ui.store.get().dismissedIds.size === 0) {
      return;
    }
    this.ui.clearDismissed();
    const hidden = this.data.get().items.filter((item) => this.hiddenByQuery(item));
    if (hidden.length === 0) {
      return;
    }
    this.data.set((data) => ({ ...data, items: data.items.filter((item) => !this.hiddenByQuery(item)) }));
    for (const item of hidden) {
      this.ui.forget(item.id);
    }
  }

  item(id: string): FeedItemView | undefined {
    return this.data.get().items.find((item) => item.id === id);
  }

  /** 一条的新样子（写操作的回答、事件流、409 带来的现在那一条）。比手里旧的不换。 */
  applyItem(item: FeedItemView): void {
    this.loader.note({ type: 'feed.changed', item });
    if (!this.accept(item)) {
      return;
    }
    const before = this.item(item.id);
    this.place(item);
    // 服务端列表里有没有它（就地留着等撤销的那条，服务端已经不列了）。
    const listedBefore = before !== undefined && !this.hiddenByQuery(before);
    const listedNow = this.item(item.id) !== undefined && !this.hiddenByQuery(item);
    if ((before === undefined || listedBefore !== listedNow) && this.data.get().status === 'ready') {
      // 成员变化会改变 offset：废弃在路上的页，翻页前重建位置与服务端计数。
      this.pageGeneration += 1;
      this.paginationDirty = true;
      this.data.set((data) => ({ ...data, loadingMore: false }));
      this.loader.schedule();
    }
  }

  applySource(source: FeedSourceView): void {
    this.rememberSource(source);
    this.sources.set((data) => {
      if (data.sources === null) {
        return data;
      }
      return { ...data, sources: this.groupSources(data.sources) };
    });
  }

  private rememberSource(source: FeedSourceView): void {
    const known = this.sourceRows.get(source.id);
    if (known === undefined || known.version < source.version) {
      this.sourceRows.set(source.id, source);
    }
  }

  private groupSources(snapshot: FeedSourcesResponse): FeedSourcesResponse {
    const rows = [...this.sourceRows.values()];
    return {
      ...snapshot,
      interests: rows.filter((source) => source.kind === 'interest'),
      blocked: rows.filter((source) => source.kind === 'blocked_site'),
      others: rows.filter((source) => source.kind === 'internal' || source.kind === 'rss' || source.kind === 'x'
        || source.kind === 'reddit' || source.kind === 'xhs'),
    };
  }

  private query(offset: number): FeedListQuery {
    const { includeHidden, savedOnly, kind, sourceId, place } = this.ui.store.get();
    return { tz: this.timeZone, offset, ...(includeHidden ? { includeHidden } : {}),
      ...(savedOnly ? { saved: true } : {}), ...(kind === null ? {} : { kind }),
      ...(sourceId === null ? {} : { sourceId }), ...(place === null ? {} : { place }) };
  }

  private accept(item: FeedItemView): boolean {
    const known = this.versions.get(item.id);
    if (known !== undefined && known >= item.version) {
      return false;
    }
    this.versions.set(item.id, item.version);
    return true;
  }

  /** 按现在的条件服务端列不列它：不感兴趣（没开「连不感兴趣的一起看」）、只看收藏时没收藏、分段在别的那一路。 */
  private hiddenByQuery(item: FeedItemView): boolean {
    const { includeHidden, savedOnly, kind, sourceId, place } = this.ui.store.get();
    return (item.reaction === 'dislike' && !includeHidden) || (savedOnly && !item.saved)
      || (kind !== null && item.kind !== kind) || (sourceId !== null && item.sourceId !== sourceId)
      || (place !== null && !(item.places ?? []).includes(place));
  }

  /**
   * 换上一条；藏起来的从列表收走，它的「为什么推给你」展开状态一起清掉。这次刚点了「不感兴趣」的就地留着等撤销。
   */
  private place(item: FeedItemView): void {
    const hidden = this.hiddenByQuery(item) && !this.ui.isDismissed(item.id);
    this.data.set((data) => {
      const rest = data.items.filter((candidate) => candidate.id !== item.id);
      return { ...data, items: hidden ? rest : [...rest, item].sort(compareFeedItems) };
    });
    if (hidden) {
      this.ui.forget(item.id);
    }
  }

  private onEvent(event: LiveEvent): void {
    if (this.data.get().status === 'idle') {
      return;
    }
    if (event.type === 'feed.changed') {
      this.applyItem(event.item);
    } else if (event.type === 'resync') {
      void this.reload();
      void this.loadSources();
    }
  }

  /**
   * 换上快照：版本表跟快照一致（先清空），再放一遍拉的期间到的事件，比快照新的才换。等撤销的那几条快照里没有（服务端
   * 不列不感兴趣的），照手里的留着。
   */
  private applySnapshot(snapshot: FeedListResponse, replay: readonly LiveEvent[]): void {
    this.snapshotPending = false;
    const listed = new Set(snapshot.items.map((item) => item.id));
    const kept = this.data.get().items.filter((item) => this.ui.isDismissed(item.id) && !listed.has(item.id));
    this.versions.clear();
    for (const item of [...snapshot.items, ...kept]) {
      this.versions.set(item.id, item.version);
    }
    this.data.set({
      status: 'ready',
      error: null,
      items: kept.length === 0 ? snapshot.items : [...snapshot.items, ...kept].sort(compareFeedItems),
      nextOffset: snapshot.nextOffset,
      newToday: snapshot.newToday,
      loadingMore: false,
      moreError: null,
    });
    for (const event of replay) {
      if (event.type === 'feed.changed') {
        this.applyItem(event.item);
      }
    }
  }
}
