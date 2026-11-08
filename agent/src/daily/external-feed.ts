// 关注点搜新闻：每日七点与手动刷新共用一次收集、一次选材；先记运行身份，中断不重放模型，写入只追加。第 3 批（11-04）
// 起订阅不走这里（feed-subscriptions.ts）；这一路成没成记在「按关注点搜新闻」这个来源的状态上，设置那一行写原因。
import type { FeedSelector } from '../../shared/feed-selection.ts';
import type { FeedRefresh } from '../../shared/feed-refresh.ts';
import type { FeedItem, FeedSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, failureText, safeLog } from '../shared-log.ts';
import { BACKGROUND_TIME_ZONE, localDay } from './days.ts';
import { BUILT_IN_SOURCES } from './feed.ts';
import type { DiscoveredFeed, FeedFetcher } from './feed-fetch.ts';
import { collectCandidates } from './feed-candidates.ts';
import { pickFeed } from './feed-picks.ts';

const FETCH_HOUR = 7;

export interface ExternalFeedOptions {
  state: StateService;
  now: () => Date;
  fetcher: FeedFetcher;
  select: FeedSelector;
  onAdded?: (item: FeedItem) => void;
}

export class ExternalFeed {
  readonly #options: ExternalFeedOptions;
  readonly #controller = new AbortController();
  #running: Promise<void> | null = null;

  constructor(options: ExternalFeedOptions) {
    this.#options = options;
    options.state.feedFetchRuns.interruptRefreshes();
  }

  #day(): string {
    const { state, now } = this.#options;
    return localDay(now(), state.dailySettings.read().settings.timeZone ?? BACKGROUND_TIME_ZONE);
  }

  /** 在 API 回执事务内排队，提交后 resume；旧请求即使过了 API 缓存期也不会重做。 */
  queueRefresh(requestId: string): FeedRefresh {
    return this.#options.state.feedFetchRuns.queue(requestId, this.#day());
  }

  resume(): boolean {
    if (this.#running !== null || this.#controller.signal.aborted) { return false; }
    const { feedFetchRuns } = this.#options.state;
    const next = feedFetchRuns.next();
    if (next === undefined || !feedFetchRuns.claim(next.requestId)) { return false; }
    this.#start(next.day, next.requestId);
    return true;
  }

  scan(): 'started' | 'skipped' {
    if (this.resume()) { return 'started'; }
    const { state, now } = this.#options;
    const zone = state.dailySettings.read().settings.timeZone ?? BACKGROUND_TIME_ZONE;
    const at = now();
    const clock = new Intl.DateTimeFormat('en', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' });
    const hour = Number(clock.format(at));
    const day = localDay(at, zone);
    if (hour < FETCH_HOUR || this.#running !== null || this.#controller.signal.aborted
      || state.feedFetchRuns.has(day) || this.#news().level === 'off' || !state.feedSources.all()
        .some((source) => source.kind === 'interest' && source.level !== 'off')) {
      return 'skipped';
    }
    if (!state.feedFetchRuns.start(day)) {
      return 'skipped';
    }
    this.#start(day, null);
    return 'started';
  }

  async settled(): Promise<void> {
    while (this.#running !== null) { await this.#running; }
  }
  async stop(): Promise<void> {
    this.#controller.abort();
    await this.settled();
  }

  async discover(url: string, signal: AbortSignal): Promise<DiscoveredFeed> {
    return this.#options.fetcher.discover(url, AbortSignal.any([signal, this.#controller.signal]));
  }

  #start(day: string, requestId: string | null): void {
    this.#running = this.#run(day, requestId).catch((error: unknown) => {
      this.#finish(day, requestId, 0, `信息流没有完成：${failureText(error)}；请稍后刷新。`, true);
      safeLog('error', 'external_feed_failed', { category: errorCategory(error), error });
    }).finally(() => {
      this.#running = null;
      this.resume();
    });
  }

  #news(): FeedSource {
    const { ref, kind, label } = BUILT_IN_SOURCES.news;
    return this.#options.state.feedSources.ensure({ ref, kind, label, level: 'normal' });
  }

  #finish(day: string, requestId: string | null, added: number, error: string | null, failed = false): void {
    const { state } = this.#options;
    if (requestId === null) { state.feedFetchRuns.finish(day, error); }
    else { state.feedFetchRuns.finishRefresh(requestId, added, error, failed); }
    const at = this.#options.now().toISOString();
    if (error === null) { state.feedSourceStatus.succeeded(this.#news().id, at, added); }
    else { state.feedSourceStatus.failed(this.#news().id, at, error); }
  }

  async #run(day: string, requestId: string | null): Promise<void> {
    const { state, fetcher, select, now } = this.#options;
    const signal = this.#controller.signal;
    const collected = await collectCandidates(state, fetcher, now(), signal);
    const { candidates, failures, reactions } = collected;
    signal.throwIfAborted();
    const input = { candidates, reactions,
      interests: state.feedSources.all().filter((source) => source.kind === 'interest' && source.level !== 'off')
        .map((source) => ({ id: source.id, label: source.label, query: source.query })) };
    const result = candidates.length === 0 ? { picks: [], error: null } : await pickFeed(input, select, signal);
    signal.throwIfAborted();
    const errors = [failures === 0 ? null : `${failures} 个搜索词或订阅没抓到：${collected.errors.join('；')}。`,
      result.error].filter((message): message is string => message !== null);
    const added: FeedItem[] = [];
    state.transaction(() => {
      const known = state.feedItems.knownUrls();
      for (const picked of result.picks) {
        const candidate = candidates.find((item) => item.id === picked.id);
        if (candidate === undefined || known.has(candidate.url)) { continue; }
        const source = state.feedSources.require(picked.sourceId ?? candidate.sourceId);
        if (source.level === 'off') { continue; }
        const { item, created } = state.feedItems.add({ sourceId: source.id, origin: 'feed',
          title: candidate.title, url: candidate.url, publishedAt: candidate.publishedAt,
          topic: source.kind === 'interest' ? source.label : null, concernId: source.concernId,
          summary: picked.summary, why: picked.why, dedupeKey: `rss:${candidate.id}`, day,
          arrivedAt: now().toISOString() });
        known.add(candidate.url);
        if (created) { added.push(item); }
      }
      this.#finish(day, requestId, added.length, errors.join('\n') || null);
    });
    for (const item of added) {
      try { this.#options.onAdded?.(item); }
      catch (cause) {
        errors.push(`条目「${item.title}」已保存，通知未完成：${failureText(cause)}`);
        safeLog('error', 'after_commit_failed', { category: errorCategory(cause), error: cause,
          stepKey: 'feed_notify', objectId: item.id });
      }
    }
    this.#finish(day, requestId, added.length, errors.join('\n') || null);
  }
}
