// 假的信息流来源管理（第 7 批第 10、13 条，和 agent/src/app/feed-sources.ts、feed-nav.ts 一样）：第二栏每个来源一行
// 带今天新来的个数；加 Reddit 版块（先预览三条）；设置里改名字、网址、档位、排序；现在刷新；删掉（内置的不删，删了的
// 不再列，没收藏过的条目跟着拿掉）。

import { ApiError, ConflictError } from '../errors.ts';
import {
  FEED_NAV_LABELS,
  redditFeedOf,
  redditFeedUrl,
  redditLabel,
  subredditOf,
  type AddRedditRequest,
  type DeleteFeedSourceRequest,
  type FeedNavResponse,
  type FeedNavSource,
  type RedditPreviewQuery,
  type RedditPreviewResponse,
  type RefreshFeedSourceRequest,
  type RefreshFeedSourceResponse,
  type UpdateFeedSourceRequest,
} from '../shared.ts';
import type { FeedItemView, FeedSourceView } from '../types.ts';
import type { FakeFeedDeps } from './fake-feed.ts';

const STALE_NEXT = '看 current 里的最新版，确认后用最新的 version 再来。';
const HOUR_MS = 60 * 60 * 1000;
/** 假预览里的帖子（演示用）。 */
const PREVIEW_TITLES = [
  '海马体「时间细胞」在小鼠走迷宫时会按顺序重放，新论文给出了单细胞记录',
  '为什么我们记得住旋律却记不住歌词？听觉记忆的两条通路',
  '睡眠剥夺 24 小时后，前额叶对杏仁核的抑制减弱',
];

export interface FakeFeedRows {
  sources: Map<string, FeedSourceView>;
  items: Map<string, FeedItemView>;
  removed: Set<string>;
  /** 这一条在今天（按时区）显示着、算不算数。 */
  freshToday: (item: FeedItemView, timeZone: string) => boolean;
  seedSource: (seed: Pick<FeedSourceView, 'id' | 'kind' | 'label'> & Partial<FeedSourceView>) => FeedSourceView;
}

function notFound(): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这个来源。', status: 404 });
}

export class FakeFeedSources {
  private readonly deps: FakeFeedDeps;
  private readonly rows: FakeFeedRows;

  constructor(deps: FakeFeedDeps, rows: FakeFeedRows) {
    this.deps = deps;
    this.rows = rows;
  }

  nav(timeZone: string): FeedNavResponse {
    const fresh = [...this.rows.items.values()].filter((item) => this.rows.freshToday(item, timeZone));
    const live = [...this.rows.sources.values()].filter((source) => !this.rows.removed.has(source.id));
    const places = (source: FeedSourceView): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const item of fresh.filter((entry) => entry.sourceId === source.id)) {
        for (const place of item.places ?? []) counts[place] = (counts[place] ?? 0) + 1;
      }
      return counts;
    };
    const row = (kind: FeedNavSource['kind'], source: FeedSourceView | undefined, count: number):
      FeedNavSource[] => source === undefined ? [] : [{ kind, source, count,
      label: kind === 'rss' || kind === 'reddit' ? source.label : FEED_NAV_LABELS[kind],
      problem: kind === 'douyin' ? null : source.status?.error ?? null,
      ...(kind === 'x' || kind === 'xhs' ? { places: places(source) } : {}) }];
    const ofKind = (kind: FeedItemView['kind']): number => fresh.filter((item) => item.kind === kind).length;
    const bySource = (id: string): number => fresh.filter((item) => item.sourceId === id).length;
    const builtIn = (ref: string): FeedSourceView | undefined => live.find((source) => source.ref === ref);
    return {
      all: fresh.length,
      sources: [
        ...row('news', builtIn('internal:news'), ofKind('news')),
        ...row('x', builtIn('x:following'), ofKind('x')),
        ...row('xhs', builtIn('xhs:feed'), ofKind('xhs')),
        ...row('douyin', builtIn('douyin:favorites'), ofKind('douyin')),
        ...live.filter((source) => source.kind === 'reddit')
          .flatMap((source) => row('reddit', source, bySource(source.id))),
        ...live.filter((source) => source.kind === 'rss')
          .flatMap((source) => row('rss', source, bySource(source.id))),
      ],
    };
  }

  previewReddit(query: RedditPreviewQuery): RedditPreviewResponse {
    const subreddit = subredditOf(query.subreddit);
    if (subreddit === null) {
      return { subreddit: null, posts: [], error: '版块名只能是字母、数字和下划线' };
    }
    if (subreddit.toLowerCase() === 'nowhere') {
      return { subreddit, posts: [], error: '地址打不开（404），请检查名字或地址。' };
    }
    const now = this.deps.now().getTime();
    return { subreddit, error: null, posts: PREVIEW_TITLES.map((title, index) => ({ title,
      url: `https://www.reddit.com/r/${subreddit}/comments/${index}/`, author: `u/poster_${index}`,
      publishedAt: new Date(now - [2, 6, 9][index]! * HOUR_MS).toISOString() })) };
  }

  addReddit(input: AddRedditRequest): FeedSourceView {
    const subreddit = subredditOf(input.subreddit);
    if (subreddit === null) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, field: 'subreddit',
        message: '版块名只能是字母、数字和下划线，比如 neuroscience。' });
    }
    const id = `reddit_${subreddit.toLowerCase()}`;
    this.rows.removed.delete(id);
    return this.rows.seedSource({ id, kind: 'reddit', label: redditLabel(subreddit),
      query: redditFeedUrl(subreddit, input.sort), level: 'normal' });
  }

  update(id: string, input: UpdateFeedSourceRequest): FeedSourceView {
    const source = this.writable(id, input.version);
    const reddit = source.query === null ? null : redditFeedOf(source.query);
    const query = input.sort !== undefined && reddit !== null ? redditFeedUrl(reddit.subreddit, input.sort)
      : input.url?.trim() ?? source.query;
    const next: FeedSourceView = { ...source, label: input.label?.trim() ?? source.label,
      level: input.level ?? source.level, query, version: source.version + 1 };
    this.rows.sources.set(id, next);
    return next;
  }

  refresh(id: string, _input: RefreshFeedSourceRequest): RefreshFeedSourceResponse {
    const source = this.rows.sources.get(id);
    if (source === undefined) {
      throw notFound();
    }
    const at = this.deps.now().toISOString();
    const next = { ...source, status: { checkedAt: at, okAt: at, error: null } };
    this.rows.sources.set(id, next);
    return { source: next, added: 0 };
  }

  remove(id: string, input: DeleteFeedSourceRequest): FeedSourceView {
    const source = this.writable(id, input.version);
    if (source.kind !== 'rss' && source.kind !== 'reddit') {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400,
        message: '内置的来源不能删，可以暂停。' });
    }
    const next = { ...source, level: 'off' as const, version: source.version + 1 };
    this.rows.sources.set(id, next);
    this.rows.removed.add(id);
    return next;
  }

  private writable(id: string, version: number): FeedSourceView {
    const source = this.rows.sources.get(id);
    if (source === undefined) {
      throw notFound();
    }
    if (source.version !== version) {
      throw new ConflictError(source, '这个来源在别处改过了，这次没有改。', STALE_NEXT);
    }
    return source;
  }
}
