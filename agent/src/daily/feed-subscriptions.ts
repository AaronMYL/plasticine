// 订阅和 X 上他关注的人（第 3 批，用户 11-04 定）：是他自己选的来源，直接进信息流，不经模型选材——模型额度用完
// （11-04 那次）也照常有内容；只去重（同一网址、同一帖子只一条）、按档位限每次的条数、字面匹配关注点。
// 订阅每 2 小时抓一次；X、小红书由电脑在线时读（/v2/nodes/feed/x、/xhs，读到的交到 ingestX、ingestXhs）。每个来源
// 这一次成没成记在 feedSourceStatus，设置里那一行写出来；抓不到不弹卡。

import type { ComputerFetchReport } from '../../shared/api/feed-computer-fetch.ts';
import type { XTimelineDue, XTimelineReport } from '../../shared/api/feed-x.ts';
import type { XhsDue, XhsReport } from '../../shared/api/feed-xhs.ts';
import type { FeedItem, FeedItemInput, FeedSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, failureText, safeLog } from '../shared-log.ts';
import { BACKGROUND_TIME_ZONE, localDay } from './days.ts';
import { BUILT_IN_SOURCES } from './feed.ts';
import { computerFailureText, handOffText, type ComputerFetches } from './computer-fetch.ts';
import { articleEntry, newest, noteEntry, postEntry, redditEntry, type NewEntry } from './feed-entries.ts';
import { feedLinkIn, looksLikeFeed, type FeedFetcher } from './feed-fetch.ts';
import { matchInterest } from './feed-match.ts';
import { parseFeed } from './feed-parse.ts';
import { DailyError, shownError } from './errors.ts';
import { siteOf } from './urls.ts';
import { REDDIT_WINDOW_MS, redditPost, type RedditPost } from './reddit.ts';

/** 用户 11-04：「不花钱、频率低，比如每 2 小时」——订阅和 X 一样。 */
export const FEED_SOURCE_EVERY_MS = 2 * 60 * 60 * 1000;
// 每次最多进几条：多档全要（上限防一次灌满），正常十条，少档三条。
const PER_ROUND: Readonly<Record<FeedSource['level'], number>> = { more: 40, normal: 10, less: 3, off: 0 };
// Reddit 限流（429）后这个版块先停这么久再取，再碰上就翻倍，最多停到下一个两小时（第13批：只停那一个版块，不停整组）。
const REDDIT_BACKOFF_MS = 30 * 60 * 1000;
// 一轮里两个 Reddit 版块之间隔一会儿，别一下子连着打。
const REDDIT_GAP_MS = 2_000;
/** 加 Reddit 来源时的预览：最新几条。 */
export const REDDIT_PREVIEW_COUNT = 3;
/** 预览取到的留多久：这么久里加上这个版块，就把预览取到的直接存进来（第13批），不再取一次。 */
const PREVIEW_KEPT_MS = 15 * 60 * 1000;
/** 博客第一次抓：导入最近这么多篇，不管是不是两天内发的（第13批，阮一峰的只收到一篇）。 */
const FIRST_IMPORT = 10;
const POLLED_KINDS = ['rss', 'reddit'] as const;

export const X_READ_ERROR_TEXT: Readonly<Record<NonNullable<XTimelineReport['error']>['code'], string>> = {
  signed_out: '在 Plasticine 浏览器里登录 X',
  layout_changed: 'X 改版了，这次没读到帖子',
  load_failed: 'X 的页面没打开',
};

export const XHS_READ_ERROR_TEXT: Readonly<Record<NonNullable<XhsReport['error']>['code'], string>> = {
  signed_out: '在 Plasticine 浏览器里登录小红书',
  verify: '小红书要你验证一下：在 Plasticine 浏览器里打开小红书，过了验证再刷新',
  layout_changed: '小红书改版了，这次没读到笔记',
  load_failed: '小红书的页面没打开',
};

export interface FeedSubscriptionsOptions {
  state: StateService;
  now: () => Date;
  fetcher?: FeedFetcher;
  onAdded?: (item: FeedItem) => void;
  /** 两个 Reddit 版块之间隔多久（测试给 0）。 */
  redditGapMs?: number;
  /** 服务器取不到时交给在线的电脑取（第13批）。 */
  computer?: ComputerFetches;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

export class FeedSubscriptions {
  readonly #options: FeedSubscriptionsOptions;
  readonly #controller = new AbortController();
  #running: Promise<void> | null = null;
  /** 限流了的 Reddit 版块到这个时刻之前不取；连着限流时停得更久（按版块记，第13批）。 */
  readonly #redditPausedUntil = new Map<string, number>();
  readonly #redditBackoffMs = new Map<string, number>();
  /** 加版块前预览取到的（按订阅地址），加上了就直接存进来。 */
  readonly #previews = new Map<string, { at: number; posts: RedditPost[] }>();

  constructor(options: FeedSubscriptionsOptions) {
    this.#options = options;
  }

  /** X、小红书和「兴趣」（按关注点搜新闻）三个内置来源（设置里各一行）；第一次要时建，之后拿回同一行。 */
  builtIn(key: 'x' | 'news' | 'xhs'): FeedSource {
    const { ref, kind, label } = BUILT_IN_SOURCES[key];
    return this.#options.state.feedSources.ensure({ ref, kind, label, level: 'normal' });
  }

  #due(source: FeedSource): boolean {
    if (source.level === 'off') { return false; }
    const status = this.#options.state.feedSourceStatus.read(source.id);
    return status === undefined
      || Date.parse(status.checkedAt) + FEED_SOURCE_EVERY_MS <= this.#options.now().getTime();
  }

  /** 外环扫描：到点的订阅在后台抓一轮；上一轮没完就不叠。 */
  scan(): 'started' | 'skipped' {
    if (this.#running !== null || this.#controller.signal.aborted || this.#options.fetcher === undefined) {
      return 'skipped';
    }
    const now = this.#options.now().getTime();
    const due = POLLED_KINDS.flatMap((kind) => this.#options.state.feedSources.all({ kind }))
      .filter((source) => source.query !== null && this.#due(source)
        && (source.kind !== 'reddit' || now >= (this.#redditPausedUntil.get(source.id) ?? 0)));
    if (due.length === 0) { return 'skipped'; }
    this.#running = this.#poll(due).finally(() => { this.#running = null; });
    return 'started';
  }

  /**
   * 「现在刷新」（第 7 批第 10 条）：订阅和 Reddit 马上取这一个（上一轮还在跑就等它跑完再取），回这次加了几条；
   * X、小红书由电脑客户端读，把它记成到点，客户端下次来问时就去读。
   */
  async refreshNow(sourceId: string): Promise<number> {
    const { state } = this.#options;
    const source = state.feedSources.require(sourceId);
    if (source.kind === 'x' || source.kind === 'xhs') {
      state.feedSourceStatus.expire(source.id);
      return 0;
    }
    if (!POLLED_KINDS.some((kind) => kind === source.kind) || source.query === null) {
      throw shownError('invalid_input', '这个来源不能单独刷新。');
    }
    await this.settled();
    const before = state.feedSourceStatus.read(source.id)?.checkedAt;
    this.#running = this.#poll([source], true).finally(() => { this.#running = null; });
    await this.#running;
    const after = state.feedSourceStatus.read(source.id);
    return after?.checkedAt === before ? 0 : after?.added ?? 0;
  }

  /** 加 Reddit 来源前的预览：取一次、不入库，回最新几条；取不到就抛出原因。 */
  async previewReddit(url: string, signal: AbortSignal): Promise<RedditPost[]> {
    const { fetcher, now } = this.#options;
    if (fetcher === undefined) {
      throw shownError('invalid_input', 'Reddit 抓取还没接上，请稍后再试。');
    }
    const page = await fetcher.get(url, signal);
    const posts = parseFeed(page.text, page.url, now(), REDDIT_WINDOW_MS).map(redditPost);
    this.#previews.set(url, { at: now().getTime(), posts });
    return posts.slice(0, REDDIT_PREVIEW_COUNT);
  }

  /** 刚加上的 Reddit 版块：预览时取到的直接存进来（十五分钟内的），加完马上有内容。回存了几条。 */
  ingestPreview(sourceId: string): number {
    const { state, now } = this.#options;
    const source = state.feedSources.require(sourceId);
    const preview = source.query === null ? undefined : this.#previews.get(source.query);
    if (source.query === null || preview === undefined || preview.at + PREVIEW_KEPT_MS < now().getTime()) {
      return 0;
    }
    this.#previews.delete(source.query);
    const added = this.#ingest(source, preview.posts.map(redditEntry));
    state.feedSourceStatus.succeeded(source.id, now().toISOString(), added);
    return added;
  }

  async settled(): Promise<void> {
    while (this.#running !== null) { await this.#running; }
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    await this.settled();
  }

  async #poll(sources: readonly FeedSource[], asked = false): Promise<void> {
    const { state, fetcher, now } = this.#options;
    let reddit = 0;
    for (const source of sources) {
      if (this.#controller.signal.aborted || fetcher === undefined) { return; }
      if (source.kind === 'reddit') {
        if (!asked && now().getTime() < (this.#redditPausedUntil.get(source.id) ?? 0)) { continue; }
        if (reddit > 0) { await wait(this.#options.redditGapMs ?? REDDIT_GAP_MS, this.#controller.signal); }
        reddit += 1;
      }
      try {
        const page = await fetcher.get(source.query ?? '', this.#controller.signal);
        this.#take(state.feedSources.require(source.id), page);
        if (source.kind === 'reddit') { this.#redditBackoffMs.delete(source.id); }
      } catch (error) {
        if (this.#controller.signal.aborted) { return; }
        const reason = this.#failure(source, error);
        state.feedSourceStatus.failed(source.id, now().toISOString(), this.#handOff(source, error) ?? reason);
        safeLog('warn', 'feed_subscription_failed', { objectId: source.id, category: errorCategory(error), error });
      }
    }
  }

  /** 取到的一页（服务器自己取的，或电脑替它取的）：解析、入库、记成功。回加了几条。 */
  #take(source: FeedSource, page: { text: string; url: string }): number {
    const { state, now } = this.#options;
    // 博客收得还少（第一次抓、或者以前只收两天内的只收到一两篇）：不限两天，导入到最近十篇为止。
    const count = state.feedItems.countForSource(source.id);
    const first = source.kind === 'rss' && count < FIRST_IMPORT;
    const entries = source.kind === 'reddit'
      ? parseFeed(page.text, page.url, now(), REDDIT_WINDOW_MS).map((hit) => redditEntry(redditPost(hit)))
      : parseFeed(page.text, page.url, now(), first ? Infinity : undefined).map(articleEntry);
    const added = this.#ingest(source, entries, first ? FIRST_IMPORT - count : undefined);
    state.feedSourceStatus.succeeded(source.id, now().toISOString(), added);
    return added;
  }

  /** 服务器没取到：电脑在线就排给它，回来源那一行要写的话；不交给电脑回 null。 */
  #handOff(source: FeedSource, error: unknown): string | null {
    const text = handOffText(source.kind, error);
    if (text === null || source.query === null) { return null; }
    return this.#options.computer?.ask(source.query, { sourceId: source.id, discover: false }) === true ? text : null;
  }

  /**
   * 电脑替服务器取回来一件（第13批）：取到了照服务器自己取到的入库；给的是网站地址、取回来是网页的，找订阅地址换上再让
   * 电脑取订阅；没取到写两边都没取到。回这件是不是还排着（交两次、早过期的回 false）。
   */
  fetchedByComputer(report: ComputerFetchReport): boolean {
    const { state, now } = this.#options;
    const job = this.#options.computer?.take(report.jobId);
    if (job === undefined) { return false; }
    const source = state.feedSources.get(job.purpose.sourceId);
    if (source === undefined || state.feedSources.removed(source.id) || source.level === 'off') { return true; }
    try {
      if (report.page === null) {
        state.feedSourceStatus.failed(source.id, now().toISOString(), computerFailureText(report.error));
      } else if (job.purpose.discover && !looksLikeFeed(report.page.text)) {
        this.#discovered(source, report.page);
      } else {
        this.#take(source, report.page);
      }
    } catch (error) {
      state.feedSourceStatus.failed(source.id, now().toISOString(), failureText(error));
      safeLog('warn', 'feed_computer_fetch_failed', { objectId: source.id, category: errorCategory(error), error });
    }
    return true;
  }

  /** 电脑取回的是网页：找订阅地址换上（名字还是网址的换成网站名），再让电脑取订阅；没有订阅源就写出来。 */
  #discovered(source: FeedSource, page: { text: string; url: string }): void {
    const { state, now } = this.#options;
    const found = feedLinkIn(page.text, page.url);
    if (found === null) {
      state.feedSourceStatus.failed(source.id, now().toISOString(), '这个网站没有订阅源');
      return;
    }
    const named = source.query !== null && source.label === siteOf(source.query) && found.title !== null;
    state.feedSources.update(source.id, source.version, { query: found.url,
      ...(named ? { label: (found.title ?? source.label).slice(0, 200) } : {}) });
    const asked = this.#options.computer?.ask(found.url, { sourceId: source.id, discover: false }) === true;
    state.feedSourceStatus.failed(source.id, now().toISOString(),
      asked ? '找到了订阅地址，正让电脑去取' : '找到了订阅地址，电脑下次在线时再取');
  }

  /** 没取到的原因；Reddit 限流时只停这一个版块，写清几分钟后再取。 */
  #failure(source: FeedSource, error: unknown): string {
    if (source.kind !== 'reddit' || !(error instanceof DailyError) || error.code !== 'rate_limited') {
      return failureText(error);
    }
    const backoff = this.#redditBackoffMs.get(source.id) ?? REDDIT_BACKOFF_MS;
    this.#redditPausedUntil.set(source.id, this.#options.now().getTime() + backoff);
    this.#redditBackoffMs.set(source.id, Math.min(backoff * 2, FEED_SOURCE_EVERY_MS));
    return `Reddit 限流，${String(Math.round(backoff / 60_000))} 分钟后再取`;
  }

  /** Mac 来问到没到读 X 的时候。 */
  xDue(): XTimelineDue {
    return { due: this.#due(this.builtIn('x')), everyMinutes: FEED_SOURCE_EVERY_MS / 60_000 };
  }

  /** 电脑读完交来的结果：有错只记原因；有帖子就入库。返回新加了几条。 */
  ingestX(report: XTimelineReport): number {
    const error = report.error === null ? null : { ...report.error, reason: X_READ_ERROR_TEXT[report.error.code] };
    return this.#ingestRead(this.builtIn('x'), error, report.posts.map(postEntry));
  }

  /** 电脑来问到没到读小红书的时候（第13批）。 */
  xhsDue(): XhsDue {
    return { due: this.#due(this.builtIn('xhs')), everyMinutes: FEED_SOURCE_EVERY_MS / 60_000 };
  }

  /** 电脑读完小红书交来的结果，和 X 一样。 */
  ingestXhs(report: XhsReport): number {
    const error = report.error === null ? null : { ...report.error, reason: XHS_READ_ERROR_TEXT[report.error.code] };
    return this.#ingestRead(this.builtIn('xhs'), error, report.notes.map(noteEntry));
  }

  /**
   * 电脑读的来源（X、小红书）交来一轮：有错只记原因（没登录、要验证时不带系统说法）；有条目就入库，几处各取最新的几条。
   */
  #ingestRead(source: FeedSource, error: { code: string; detail?: string; reason: string } | null,
    entries: readonly NewEntry[]): number {
    const { state, now } = this.#options;
    const at = now().toISOString();
    if (error !== null) {
      const detail = error.detail?.trim() ?? '';
      const plain = detail === '' || error.code === 'signed_out' || error.code === 'verify';
      state.feedSourceStatus.failed(source.id, at, plain ? error.reason : `${error.reason}：${detail}`);
      return 0;
    }
    if (source.level === 'off') { return 0; }
    const added = this.#ingest(source, entries, undefined, true);
    state.feedSourceStatus.succeeded(source.id, at, added);
    return added;
  }

  /**
   * 一批条目进库：已有的网址、帖子跳过，档位限条数，按发布时间从旧到新写，到达时间逐条加一毫秒——同一批在信息流里
   * 仍是新发的在前（列表按到达时间排）。提交后再通知。
   */
  #ingest(source: FeedSource, entries: readonly NewEntry[], limit?: number, perPlace = false): number {
    const { state, now } = this.#options;
    const linked = source.concernId === null ? undefined : state.feedSources.all({ kind: 'interest' })
      .find((row) => row.concernId === source.concernId);
    if (source.level === 'off' || linked?.level === 'off') { return 0; }
    const interests = state.feedSources.all({ kind: 'interest' });
    const zone = state.dailySettings.read().settings.timeZone ?? BACKGROUND_TIME_ZONE;
    const at = now();
    const day = localDay(at, zone);
    const added: FeedItem[] = [];
    state.transaction(() => {
      const known = state.feedItems.knownUrls();
      // 已经有的不另加一条：在别处又看到的（关注里有、又进了书签）把那一处并进去，以前没存全文的补上全文。
      for (const entry of entries) {
        if (((entry.places ?? []).length > 0 || (entry.body ?? null) !== null)
          && state.feedItems.byDedupeKey(entry.key) !== undefined) {
          state.feedItems.add({ sourceId: source.id, origin: 'feed', title: entry.title, dedupeKey: entry.key, day,
            arrivedAt: at.toISOString(), places: entry.places ?? [], body: entry.body ?? null });
        }
      }
      const fresh = newest(entries.filter((entry) => !known.has(entry.url)
        && state.feedItems.byDedupeKey(entry.key) === undefined), limit ?? PER_ROUND[source.level], perPlace)
        .reverse();
      fresh.forEach((entry, index) => {
        const hit = linked ?? matchInterest(entry.text, interests);
        const input: FeedItemInput = {
          sourceId: source.id, origin: 'feed', title: entry.title, url: entry.url, summary: entry.summary,
          topic: hit?.label ?? null, concernId: hit?.concernId ?? null, dedupeKey: entry.key, day,
          publishedAt: entry.publishedAt, arrivedAt: new Date(at.getTime() + index).toISOString(),
          author: entry.author, authorHandle: entry.authorHandle, avatarUrl: entry.avatarUrl,
          imageUrl: entry.imageUrl, imageRatio: entry.imageRatio,
          ...(entry.places === undefined ? {} : { places: entry.places }),
          ...(entry.body === undefined ? {} : { body: entry.body }),
        };
        const result = state.feedItems.add(input);
        known.add(entry.url);
        if (result.created) { added.push(result.item); }
      });
    });
    for (const item of added) {
      try { this.#options.onAdded?.(item); }
      catch (cause) {
        safeLog('error', 'after_commit_failed', { category: errorCategory(cause), error: cause,
          stepKey: 'feed_notify', objectId: item.id });
      }
    }
    return added.length;
  }
}
