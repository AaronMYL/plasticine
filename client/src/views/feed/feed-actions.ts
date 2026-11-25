import type { PlasticineApi } from '../../api/client.ts';
import { ConflictError } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { FeedItemView, FeedSourceView } from '../../api/types.ts';
import type { ActionOps, ActionRequest } from '../../state/action-ops.ts';
import type { FeedUi } from '../../state/feed-ui.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import { FEED_ADD_OP_KEY, feedItemOpKey, feedLevelOpKey, feedQueryOpKey } from '../../state/daily-action-requests.ts';
import { deviceTimeZone as localTimeZone } from '../../state/time-zone.ts';
import type { FeedStore } from './feed-store.ts';

export interface FeedActionsDeps {
  api: PlasticineApi;
  store: FeedStore;
  ops: ActionOps;
  drafts: InlineDrafts;
  ui: FeedUi;
  timeZone?: string;
}

export const ADD_FIELDS = ['title', 'url', 'why'] as const;
export type AddField = (typeof ADD_FIELDS)[number];

export function addDraftKey(field: AddField): string {
  return `feed:new:${field}`;
}

type Reaction = NonNullable<FeedItemView['reaction']>;
type Level = FeedSourceView['level'];

const REACTION_LABELS: Readonly<Record<Reaction, string>> = { like: '点赞', dislike: '不感兴趣' };

function isItem(value: unknown, id: string): value is FeedItemView {
  return typeof value === 'object' && value !== null && 'id' in value && value.id === id && 'arrivedAt' in value;
}

function isSource(value: unknown, id: string): value is FeedSourceView {
  return typeof value === 'object' && value !== null && 'id' in value && value.id === id && 'level' in value;
}

export class FeedActions {
  private readonly deps: FeedActionsDeps;
  private timeZone: string;

  constructor(deps: FeedActionsDeps) {
    this.deps = deps;
    this.timeZone = deps.timeZone ?? localTimeZone();
  }

  setTimeZone(timeZone: string): void {
    this.timeZone = timeZone;
  }

  async refresh(): Promise<void> {
    const key = 'feed:refresh';
    if (this.deps.ops.get(key)?.status === 'running') { return; }
    const request = this.deps.ops.begin(key, '寻找新内容', '信息流', (requestId) => ({
      kind: 'feed_refresh', body: { requestId },
    }), createRequestId);
    await this.perform(key, request);
  }

  async addInterest(): Promise<void> {
    const key = 'feed:interest:new';
    if (this.deps.ops.get(key)?.status === 'running') { return; }
    const label = this.deps.drafts.get(`${key}:label`).trim();
    const query = this.deps.drafts.get(`${key}:query`).trim();
    const request = this.deps.ops.begin(key, '加关注点', label, (requestId) => ({
      kind: 'feed_interest', body: { requestId, label, query },
    }), createRequestId);
    await this.perform(key, request);
  }

  async blockSite(site: string, blocked: boolean): Promise<void> {
    const key = `feed:site:${site}`;
    if (this.deps.ops.get(key)?.status === 'running') { return; }
    const request = this.deps.ops.begin(key, blocked ? '屏蔽' : '恢复', site, (requestId) => ({
      kind: 'feed_block', body: { requestId, site, blocked },
    }), createRequestId);
    await this.perform(key, request);
  }

  async comment(item: FeedItemView): Promise<void> {
    const key = `feed:${item.id}:comment`;
    if (this.deps.ops.get(key)?.status === 'running') { return; }
    const text = this.deps.drafts.get(`${key}:draft`).trim();
    const request = this.deps.ops.begin(key, '评论', item.title, (requestId) => ({
      kind: 'feed_comment', itemId: item.id, body: { requestId, text },
    }), createRequestId);
    await this.perform(key, request);
  }

  async retryComment(item: FeedItemView, commentId: string): Promise<void> {
    const key = `feed:${item.id}:reply:${commentId}`;
    if (this.deps.ops.get(key)?.status === 'running') { return; }
    const request = this.deps.ops.begin(key, '重试回复', item.title, (requestId) => ({
      kind: 'feed_comment_retry', itemId: item.id, commentId, body: { requestId },
    }), createRequestId);
    await this.perform(key, request);
  }

  async react(item: FeedItemView, reaction: Reaction): Promise<void> {
    const key = feedItemOpKey(item.id, 'react');
    const next = item.reaction === reaction ? null : reaction;
    this.dismissFailed(key);
    if (next === 'dislike') {
      this.deps.ui.markDismissed(item.id);
    }
    const request = this.deps.ops.begin(
      key,
      next === null ? `取消${REACTION_LABELS[reaction]}` : REACTION_LABELS[reaction],
      item.title,
      (requestId) => ({
        kind: 'feed_react',
        itemId: item.id,
        body: { requestId, version: item.version, reaction: next },
      }),
      createRequestId,
    );
    await this.perform(key, request);
  }

  async toggleSave(item: FeedItemView): Promise<void> {
    const key = feedItemOpKey(item.id, 'save');
    this.dismissFailed(key);
    const request = this.deps.ops.begin(
      key,
      item.saved ? '取消收藏' : '收藏',
      item.title,
      (requestId) => ({
        kind: 'feed_save',
        itemId: item.id,
        body: { requestId, version: item.version, saved: !item.saved },
      }),
      createRequestId,
    );
    await this.perform(key, request);
  }

  field(field: AddField): string {
    return this.deps.drafts.get(addDraftKey(field));
  }

  cancelAdd(): void {
    for (const field of ADD_FIELDS) {
      this.deps.drafts.clear(addDraftKey(field));
    }
    this.deps.ui.setAdding(false);
  }

  async add(): Promise<void> {
    const title = this.field('title').trim();
    const url = this.field('url').trim();
    const why = this.field('why').trim();
    this.dismissFailed(FEED_ADD_OP_KEY);
    const request = this.deps.ops.begin(
      FEED_ADD_OP_KEY,
      '加一条链接',
      title === '' ? '新的一条' : title,
      (requestId) => ({
        kind: 'feed_add',
        timeZone: this.timeZone,
        body: { requestId, title, ...(url === '' ? {} : { url }), ...(why === '' ? {} : { why }) },
      }),
      createRequestId,
    );
    await this.perform(FEED_ADD_OP_KEY, request);
  }

  async setLevel(source: FeedSourceView, level: Level): Promise<void> {
    const key = feedLevelOpKey(source.id);
    this.dismissFailed(key);
    const request = this.deps.ops.begin(
      key,
      '调多少',
      source.label,
      (requestId) => ({
        kind: 'feed_level',
        sourceId: source.id,
        body: { requestId, version: source.version, level },
      }),
      createRequestId,
    );
    await this.perform(key, request);
  }

  async retry(key: string): Promise<void> {
    const request = this.deps.ops.retry(key);
    if (request !== undefined) {
      await this.perform(key, request);
    }
  }

  async setQuery(source: FeedSourceView): Promise<void> {
    const key = feedQueryOpKey(source.id);
    this.dismissFailed(key);
    const request = this.deps.ops.begin(key, '保存搜索词', source.label, (requestId) => ({
      kind: 'feed_query', sourceId: source.id,
      body: { requestId, version: source.version, query: this.deps.drafts.get(key).trim() },
    }), createRequestId);
    await this.perform(key, request);
  }

  dismiss(key: string): void {
    this.deps.ops.dismiss(key);
  }

  private dismissFailed(key: string): void {
    if (this.deps.ops.get(key)?.status === 'failed') {
      this.deps.ops.dismiss(key);
    }
  }

  private async perform(key: string, request: ActionRequest): Promise<void> {
    try {
      await this.send(request);
      this.deps.ops.succeed(key);
    } catch (cause) {
      this.deps.ops.fail(key, cause);
      this.onRefused(request, cause);
    }
  }

  private async send(request: ActionRequest): Promise<void> {
    const { api, store } = this.deps;
    switch (request.kind) {
      case 'feed_refresh':
        await store.refresh.collect(request.body);
        return;
      case 'feed_interest': {
        const result = await api.feed.addInterest(request.body);
        store.applySource(result.source);
        this.deps.drafts.clearIfSent('feed:interest:new:label', request.body.label);
        this.deps.drafts.clearIfSent('feed:interest:new:query', request.body.query ?? '');
        this.deps.drafts.clear('feed:interest:new:open');
        return;
      }
      case 'feed_block':
        store.applySource(await api.feed.blockSite(request.body));
        return;
      case 'feed_comment':
        store.applyComments(request.itemId, await api.feed.comment(request.itemId, request.body));
        this.deps.drafts.clearIfSent(`feed:${request.itemId}:comment:draft`, request.body.text);
        return;
      case 'feed_comment_retry':
        store.applyComments(request.itemId,
          await api.feed.retryComment(request.itemId, request.commentId, request.body));
        return;
      case 'feed_react':
        store.applyItem(await api.feed.react(request.itemId, request.body));
        return;
      case 'feed_save':
        store.applyItem(await api.feed.save(request.itemId, request.body));
        return;
      case 'feed_add':
        store.applyItem(await api.feed.add(request.body, request.timeZone));
        this.cancelAdd();
        return;
      case 'feed_level':
        store.applySource(await api.feed.setSourceLevel(request.sourceId, request.body));
        return;
      case 'feed_query': {
        store.applySource(await api.feed.setSourceQuery(request.sourceId, request.body));
        const key = feedQueryOpKey(request.sourceId);
        this.deps.drafts.clearIfSent(key, request.body.query);
        if (this.deps.drafts.get(key) === '') { this.deps.drafts.clear(`${key}:editing`); }
        return;
      }
      default:
        return;
    }
  }

  private onRefused(request: ActionRequest, cause: unknown): void {
    if (!(cause instanceof ConflictError)) {
      return;
    }
    const current: unknown = cause.current;
    if ((request.kind === 'feed_react' || request.kind === 'feed_save') && isItem(current, request.itemId)) {
      this.deps.store.applyItem(current);
    } else if ((request.kind === 'feed_level' || request.kind === 'feed_query')
      && isSource(current, request.sourceId)) {
      this.deps.store.applySource(current);
    }
  }
}
