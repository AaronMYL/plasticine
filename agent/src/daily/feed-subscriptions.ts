// 订阅和 X 上他关注的人（第 3 批，用户 11-04 定）：是他自己选的来源，直接进信息流，不经模型选材——模型额度用完
// （11-04 那次）也照常有内容；只去重（同一网址、同一帖子只一条）、按档位限每次的条数、字面匹配关注点。
// 订阅每 2 小时抓一次；X 由 Mac 在线时读（GET / POST /v2/nodes/feed/x，读到的交到 ingestX）。每个来源这一次成没成
// 记在 feedSourceStatus，设置里那一行写出来；抓不到不弹卡。

import { createHash } from 'node:crypto';
import type { XPost, XTimelineDue, XTimelineReport } from '../../shared/api/feed-x.ts';
import type { FeedBlock, FeedItem, FeedItemInput, FeedPlace, FeedSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, failureText, safeLog } from '../shared-log.ts';
import { BACKGROUND_TIME_ZONE, localDay } from './days.ts';
import { BUILT_IN_SOURCES } from './feed.ts';
import type { FeedFetcher } from './feed-fetch.ts';
import { matchInterest } from './feed-match.ts';
import { parseFeed } from './feed-parse.ts';
import { safeUrl } from './link-data.ts';
import { DailyError } from './errors.ts';
import { REDDIT_WINDOW_MS, redditPost, type RedditPost } from './reddit.ts';
import { articleBlocks } from './article-blocks.ts';

/** 用户 11-04：「不花钱、频率低，比如每 2 小时」——订阅和 X 一样。 */
export const FEED_SOURCE_EVERY_MS = 2 * 60 * 60 * 1000;
// 每次最多进几条：多档全要（上限防一次灌满），正常十条，少档三条。
const PER_ROUND: Readonly<Record<FeedSource['level'], number>> = { more: 40, normal: 10, less: 3, off: 0 };
// 订阅文章的摘要：卡片上只放开头这些字，点开原文看全文。
const ARTICLE_SUMMARY_CHARS = 400;
// X 帖子没有标题：取正文第一行的前这些字当标题（读屏念、问 Plasticine 时引用）。
const POST_TITLE_CHARS = 60;
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

interface NewEntry {
  key: string;
  title: string;
  url: string;
  summary: string;
  /** 订阅文章的全文（一段段）；没有就是 null。 */
  body?: FeedBlock[] | null;
  /** 在哪一处看到的（X、小红书）。 */
  places?: FeedPlace[];
  /** 拿来匹配关注点的文字。 */
  text: string;
  publishedAt: string | null;
  author: string | null;
  authorHandle: string | null;
  avatarUrl: string | null;
  imageUrl: string | null;
  imageRatio: number | null;
}

export interface FeedSubscriptionsOptions {
  state: StateService;
  now: () => Date;
  fetcher?: FeedFetcher;
  onAdded?: (item: FeedItem) => void;
  /** 两个 Reddit 版块之间隔多久（测试给 0）。 */
  redditGapMs?: number;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function httpsOrNull(raw: string | null | undefined): string | null {
  const url = safeUrl(raw);
  return url !== null && url.startsWith('https://') ? url : null;
}

function postEntry(post: XPost): NewEntry {
  const firstLine = post.text.split('\n').find((line) => line.trim() !== '') ?? '';
  return {
    key: `x:${post.id}`,
    title: firstLine === '' ? `@${post.handle}` : clip(firstLine, POST_TITLE_CHARS),
    url: `https://x.com/${post.handle}/status/${post.id}`,
    summary: post.text.trim(),
    text: post.text,
    publishedAt: post.publishedAt,
    author: post.author,
    authorHandle: post.handle,
    avatarUrl: httpsOrNull(post.avatar),
    imageUrl: httpsOrNull(post.image),
    imageRatio: post.image === null ? null : post.imageRatio,
  };
}

function articleEntry(hit: ReturnType<typeof parseFeed>[number]): NewEntry {
  const body = articleBlocks(hit.html, hit.url);
  return {
    key: `rss:${createHash('sha256').update(hit.url).digest('hex')}`,
    title: hit.title, url: hit.url, summary: clip(hit.text, ARTICLE_SUMMARY_CHARS),
    body: body.length === 0 ? null : body,
    text: `${hit.title}\n${hit.text}`, publishedAt: hit.publishedAt, author: hit.author, authorHandle: null,
    avatarUrl: null, imageUrl: httpsOrNull(hit.image), imageRatio: null,
  };
}

function redditEntry(post: RedditPost): NewEntry {
  return {
    key: `reddit:${createHash('sha256').update(post.url).digest('hex')}`,
    title: post.title, url: post.url, summary: clip(post.text, ARTICLE_SUMMARY_CHARS),
    text: `${post.title}\n${post.text}`, publishedAt: post.publishedAt, author: post.author, authorHandle: null,
    avatarUrl: null, imageUrl: httpsOrNull(post.image), imageRatio: null,
  };
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
      throw new DailyError('invalid_input', '这个来源不能单独刷新。');
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
      throw new DailyError('invalid_input', 'Reddit 抓取还没接上，请稍后再试。');
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
        // 博客收得还少（第一次抓、或者以前只收两天内的只收到一两篇）：不限两天，导入到最近十篇为止。
        const first = source.kind === 'rss' && state.feedItems.countForSource(source.id) < FIRST_IMPORT;
        const entries = source.kind === 'reddit'
          ? parseFeed(page.text, page.url, now(), REDDIT_WINDOW_MS).map((hit) => redditEntry(redditPost(hit)))
          : parseFeed(page.text, page.url, now(), first ? Infinity : undefined).map(articleEntry);
        const added = this.#ingest(state.feedSources.require(source.id), entries,
          first ? FIRST_IMPORT - state.feedItems.countForSource(source.id) : undefined);
        state.feedSourceStatus.succeeded(source.id, now().toISOString(), added);
        if (source.kind === 'reddit') { this.#redditBackoffMs.delete(source.id); }
      } catch (error) {
        if (this.#controller.signal.aborted) { return; }
        state.feedSourceStatus.failed(source.id, now().toISOString(), this.#failure(source, error));
        safeLog('warn', 'feed_subscription_failed', { objectId: source.id, category: errorCategory(error), error });
      }
    }
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

  /** Mac 读完交来的结果：有错只记原因；有帖子就入库。返回新加了几条。 */
  ingestX(report: XTimelineReport): number {
    const { state, now } = this.#options;
    const at = now().toISOString();
    const source = this.builtIn('x');
    if (report.error !== null) {
      const detail = report.error.detail?.trim() ?? '';
      const reason = X_READ_ERROR_TEXT[report.error.code];
      const plain = detail === '' || report.error.code === 'signed_out';
      state.feedSourceStatus.failed(source.id, at, plain ? reason : `${reason}：${detail}`);
      return 0;
    }
    if (source.level === 'off') { return 0; }
    const added = this.#ingest(source, report.posts.map(postEntry));
    state.feedSourceStatus.succeeded(source.id, at, added);
    return added;
  }

  /**
   * 一批条目进库：已有的网址、帖子跳过，档位限条数，按发布时间从旧到新写，到达时间逐条加一毫秒——同一批在信息流里
   * 仍是新发的在前（列表按到达时间排）。提交后再通知。
   */
  #ingest(source: FeedSource, entries: readonly NewEntry[], limit?: number): number {
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
      const fresh = entries.filter((entry) => !known.has(entry.url)
        && state.feedItems.byDedupeKey(entry.key) === undefined)
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .slice(0, limit ?? PER_ROUND[source.level])
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
