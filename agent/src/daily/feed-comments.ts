import type { FeedComment, FeedCommentGenerator } from '../../shared/feed-comments.ts';
import type { FeedItem } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { failureText, safeLog } from '../shared-log.ts';
import { bounded } from './feed-fetch.ts';

const REPLY_TIMEOUT_MS = 90_000;
const COMMENT_CONTEXT_LIMIT = 12;

export class FeedComments {
  readonly #state: StateService;
  readonly #generate: FeedCommentGenerator;
  readonly #changed: (item: FeedItem) => void;
  readonly #controller = new AbortController();
  #running: Promise<void> | null = null;

  constructor(options: { state: StateService; generate: FeedCommentGenerator; changed: (item: FeedItem) => void }) {
    this.#state = options.state;
    this.#generate = options.generate;
    this.#changed = options.changed;
  }

  list(itemId: string): FeedComment[] {
    return this.#state.feedComments.list(this.#state.feedItems.require(itemId),
      this.#state.legacyRows.forTarget('feed_items', itemId));
  }

  resume(): void {
    if (this.#running !== null || this.#controller.signal.aborted) { return; }
    this.#running = this.#drain().finally(() => { this.#running = null; });
  }

  async settled(): Promise<void> { await this.#running; }
  async stop(): Promise<void> {
    this.#controller.abort(new Error('服务停止，评论已经保存；可重试未完成的回复。'));
    await this.settled();
  }

  async #drain(): Promise<void> {
    while (!this.#controller.signal.aborted) {
      const reply = this.#state.feedComments.next();
      if (reply === undefined) { return; }
      await this.#respond(reply);
    }
  }

  async #respond(reply: FeedComment): Promise<void> {
    const state = this.#state;
    const item = state.feedItems.require(reply.itemId);
    const comment = state.feedComments.get(reply.replyTo!);
    if (comment === undefined) { throw new Error('这条回复对应的原评论没有找到。'); }
    try {
      const source = state.feedSources.require(item.sourceId);
      const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(REPLY_TIMEOUT_MS)]);
      const history = this.list(item.id);
      const before = history.slice(0, history.findIndex((row) => row.id === comment.id));
      const result = await bounded(this.#generate({ item: { title: item.title, summary: item.summary, url: item.url },
        source: { label: source.label, interest: source.kind === 'interest', level: source.level },
        previous: before.filter((row) => row.status === 'completed')
          .slice(-COMMENT_CONTEXT_LIMIT).map((row) => ({ author: row.author, text: row.text })),
        text: comment.text }, signal), signal);
      signal.throwIfAborted();
      state.transaction(() => {
        let text = result.text;
        if (result.level !== null && source.kind === 'interest') {
          const fresh = state.feedSources.require(source.id);
          if (fresh.version === source.version) {
            state.feedSources.update(source.id, source.version, { level: result.level });
            text += `\n\n「${source.label}」已调为${result.level === 'more' ? '多推' : '少推'}。`;
          } else {
            text += '\n\n这个关注点在等待回复时已调整，保留较新的档位。';
          }
        }
        state.feedComments.finish(reply.id, text, null);
      });
    } catch (cause) {
      state.feedComments.finish(reply.id, '', failureText(cause));
    }
    try { this.#changed(state.feedItems.require(item.id)); }
    catch (cause) {
      state.feedComments.notice(reply.id, `评论已保存，通知未完成：${failureText(cause)}`);
      safeLog('error', 'after_commit_failed', { error: cause, stepKey: 'feed_comment_notify', objectId: reply.id });
    }
  }
}
