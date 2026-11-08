// 订阅和 X 上他关注的人（第 3 批，用户 11-04 定）：是他自己选的来源，直接进信息流，不经模型选材——模型额度用完
// （11-04 那次）也照常有内容；只去重（同一网址、同一帖子只一条）、按档位限每次的条数、字面匹配关注点。
// 订阅每 2 小时抓一次；X 由 Mac 在线时读（GET / POST /v2/nodes/feed/x，读到的交到 ingestX）。每个来源这一次成没成
// 记在 feedSourceStatus，设置里那一行写出来；抓不到不弹卡。

import { createHash } from 'node:crypto';
import type { XPost, XTimelineDue, XTimelineReport } from '../../shared/api/feed-x.ts';
import type { FeedItem, FeedItemInput, FeedSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, failureText, safeLog } from '../shared-log.ts';
import { BACKGROUND_TIME_ZONE, localDay } from './days.ts';
import { BUILT_IN_SOURCES } from './feed.ts';
import type { FeedFetcher } from './feed-fetch.ts';
import { matchInterest } from './feed-match.ts';
import { parseFeed } from './feed-parse.ts';
import { safeUrl } from './link-data.ts';

/** 用户 11-04：「不花钱、频率低，比如每 2 小时」——订阅和 X 一样。 */
export const FEED_SOURCE_EVERY_MS = 2 * 60 * 60 * 1000;
// 每次最多进几条：多档全要（上限防一次灌满），正常十条，少档三条。
const PER_ROUND: Readonly<Record<FeedSource['level'], number>> = { more: 40, normal: 10, less: 3, off: 0 };
// 订阅文章的摘要：卡片上只放开头这些字，点开原文看全文。
const ARTICLE_SUMMARY_CHARS = 400;
// X 帖子没有标题：取正文第一行的前这些字当标题（读屏念、问 Plasticine 时引用）。
const POST_TITLE_CHARS = 60;

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

export class FeedSubscriptions {
  readonly #options: FeedSubscriptionsOptions;
  readonly #controller = new AbortController();
  #running: Promise<void> | null = null;

  constructor(options: FeedSubscriptionsOptions) {
    this.#options = options;
  }

  /** X 和「按关注点搜新闻」两个内置来源（设置里各一行）；第一次要时建，之后拿回同一行。 */
  builtIn(key: 'x' | 'news'): FeedSource {
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
    const due = this.#options.state.feedSources.all({ kind: 'rss' })
      .filter((source) => source.query !== null && this.#due(source));
    if (due.length === 0) { return 'skipped'; }
    this.#running = this.#poll(due).finally(() => { this.#running = null; });
    return 'started';
  }

  async settled(): Promise<void> {
    while (this.#running !== null) { await this.#running; }
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    await this.settled();
  }

  async #poll(sources: readonly FeedSource[]): Promise<void> {
    const { state, fetcher, now } = this.#options;
    for (const source of sources) {
      if (this.#controller.signal.aborted || fetcher === undefined) { return; }
      try {
        const page = await fetcher.get(source.query ?? '', this.#controller.signal);
        const entries = parseFeed(page.text, page.url, now()).map((hit): NewEntry => ({
          key: `rss:${createHash('sha256').update(hit.url).digest('hex')}`,
          title: hit.title, url: hit.url, summary: clip(hit.text, ARTICLE_SUMMARY_CHARS),
          text: `${hit.title}\n${hit.text}`, publishedAt: hit.publishedAt, author: hit.author, authorHandle: null,
          avatarUrl: null, imageUrl: httpsOrNull(hit.image), imageRatio: null,
        }));
        const added = this.#ingest(state.feedSources.require(source.id), entries);
        state.feedSourceStatus.succeeded(source.id, now().toISOString(), added);
      } catch (error) {
        if (this.#controller.signal.aborted) { return; }
        state.feedSourceStatus.failed(source.id, now().toISOString(), failureText(error));
        safeLog('warn', 'feed_subscription_failed', { objectId: source.id, category: errorCategory(error), error });
      }
    }
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
  #ingest(source: FeedSource, entries: readonly NewEntry[]): number {
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
      const fresh = entries.filter((entry) => !known.has(entry.url)
        && state.feedItems.byDedupeKey(entry.key) === undefined)
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .slice(0, PER_ROUND[source.level])
        .reverse();
      fresh.forEach((entry, index) => {
        const hit = linked ?? matchInterest(entry.text, interests);
        const input: FeedItemInput = {
          sourceId: source.id, origin: 'feed', title: entry.title, url: entry.url, summary: entry.summary,
          topic: hit?.label ?? null, concernId: hit?.concernId ?? null, dedupeKey: entry.key, day,
          publishedAt: entry.publishedAt, arrivedAt: new Date(at.getTime() + index).toISOString(),
          author: entry.author, authorHandle: entry.authorHandle, avatarUrl: entry.avatarUrl,
          imageUrl: entry.imageUrl, imageRatio: entry.imageRatio,
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
