import { FEED_LONG_TEXT_CHARS, type FeedTranslator } from '../../shared/feed-translation.ts';
import type { FeedItem } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { failureText, safeLog } from '../util/index.ts';
import { checkedChart } from './feed-chart-check.ts';
import { bounded } from './feed-fetch.ts';

const TRANSLATE_TIMEOUT_MS = 180_000;
const PER_SCAN_MAX = 30;
const BACKFILL_DAYS = 3;
const BACKFILL_MAX = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FeedTranslationState = Pick<StateService, 'feedItems' | 'feedTranslations'>;

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

  added(item: FeedItem): void {
    this.#state.feedTranslations.queue(item.id);
    this.resume();
  }

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
