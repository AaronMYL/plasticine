// 信息流的中文（《优化清单》第 8 条）：抓取时就翻好存下，显示时不再翻。新条目入库后排上（feed_translations），这里一条
// 一条翻：外语给中文标题和全文，长帖给中文摘要，原文明写的数字给小图表；简体中文原文只在长帖时写摘要。
// 11-07 走查：线上英文帖都没翻——当时代码里根本没有抓取时翻译这一步（维护入口也没有 feed.translate），这里补上。
// 每次扫描先把最近几天还没排上的旧条目补排，所以升级后最近的英文帖也会翻；更早的不翻（不看就不花这份钱）。

import type { FeedTranslator } from '../../shared/feed-translation.ts';
import { FEED_LONG_TEXT_CHARS } from '../../shared/feed-translation.ts';
import type { FeedItem } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { failureText, safeLog } from '../shared-log.ts';
import { checkedChart } from './feed-chart-check.ts';
import { bounded } from './feed-fetch.ts';

/** 一条最多等这么久：长文全文翻译要写几千字。 */
const TRANSLATE_TIMEOUT_MS = 180_000;
/** 一次扫描最多翻这么多条，剩下的下次扫描接着翻（扫描每 5 分钟一次）。 */
const PER_SCAN_MAX = 30;
/** 补排旧条目只看最近这么多天（信息流页默认看的就是这几天）。 */
const BACKFILL_DAYS = 3;
const BACKFILL_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FeedTranslationState = Pick<StateService, 'feedItems' | 'feedTranslations'>;

/** 送去翻的正文：X 的帖子没有标题，正文就是帖子。 */
export function sourceTextOf(item: Pick<FeedItem, 'title' | 'summary'>, post: boolean): string {
  return post ? item.summary || item.title : item.summary;
}

export class FeedTranslations {
  readonly #state: FeedTranslationState;
  readonly #translate: FeedTranslator;
  readonly #changed: (item: FeedItem) => void;
  readonly #isPost: (item: FeedItem) => boolean;
  readonly #now: () => Date;
  readonly #model: () => string | null;
  readonly #controller = new AbortController();
  #running: Promise<void> | null = null;

  constructor(options: {
    state: FeedTranslationState;
    translate: FeedTranslator;
    changed: (item: FeedItem) => void;
    isPost: (item: FeedItem) => boolean;
    now: () => Date;
    model?: () => string | null;
  }) {
    this.#state = options.state;
    this.#translate = options.translate;
    this.#changed = options.changed;
    this.#isPost = options.isPost;
    this.#now = options.now;
    this.#model = options.model ?? (() => null);
  }

  /** 新条目入库后（提交之后）调：排上并开始翻。 */
  added(item: FeedItem): void {
    this.#state.feedTranslations.queue(item.id);
    this.resume();
  }

  /** 每次扫描：补排最近的旧条目，再翻排着的。 */
  scan(): void {
    const since = new Date(this.#now().getTime() - BACKFILL_DAYS * DAY_MS).toISOString();
    this.#state.feedTranslations.backfill(since, BACKFILL_MAX);
    this.resume();
  }

  resume(): void {
    if (this.#running !== null || this.#controller.signal.aborted) {
      return;
    }
    this.#running = this.#drain().finally(() => {
      this.#running = null;
    });
  }

  async settled(): Promise<void> {
    await this.#running;
  }

  async stop(): Promise<void> {
    this.#controller.abort(new Error('服务停止，没翻完的下次启动接着翻。'));
    await this.settled();
  }

  async #drain(): Promise<void> {
    // 这一轮试过的不再试：没翻成的等下次扫描，不在同一轮里连着撞。
    const tried = new Set<string>();
    while (!this.#controller.signal.aborted && tried.size < PER_SCAN_MAX) {
      const itemId = this.#state.feedTranslations.next(PER_SCAN_MAX).find((id) => !tried.has(id));
      if (itemId === undefined) {
        return;
      }
      tried.add(itemId);
      await this.#one(itemId);
    }
  }

  async #one(itemId: string): Promise<void> {
    const item = this.#state.feedItems.require(itemId);
    const post = this.#isPost(item);
    const text = sourceTextOf(item, post);
    if (text.trim() === '' && item.title.trim() === '') {
      this.#state.feedTranslations.finish(itemId, { lang: 'und', title: null, text: null, digest: null, chart: null,
        model: null });
      return;
    }
    try {
      const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(TRANSLATE_TIMEOUT_MS)]);
      const reply = await bounded(this.#translate({ title: item.title, text, site: item.site, post }, signal), signal);
      signal.throwIfAborted();
      const long = Array.from(text).length > FEED_LONG_TEXT_CHARS;
      this.#state.feedTranslations.finish(itemId, {
        lang: reply.lang,
        title: post ? null : reply.title,
        text: reply.text,
        digest: long ? reply.digest : null,
        chart: checkedChart(reply.chart, `${item.title}\n${text}`),
        model: this.#model(),
      });
    } catch (cause) {
      if (this.#controller.signal.aborted) {
        return;
      }
      this.#state.feedTranslations.fail(itemId, failureText(cause));
      safeLog('warn', 'feed_translate_failed', { error: cause, objectId: itemId });
      return;
    }
    try {
      this.#changed(this.#state.feedItems.require(itemId));
    } catch (cause) {
      safeLog('error', 'after_commit_failed', { error: cause, stepKey: 'feed_translate_notify', objectId: itemId });
    }
  }
}
