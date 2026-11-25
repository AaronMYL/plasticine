import { Type, type Static } from 'typebox';
import {
  FEED_FILTER_KINDS,
  FEED_ITEM_KINDS,
  FEED_ORIGINS,
  FEED_PLACES,
  FeedBlockSchema,
  FEED_REACTIONS,
  FEED_SOURCE_KINDS,
  FEED_SOURCE_LEVELS,
  FEED_URL_MAX_CHARS,
  type FeedItem,
} from '../state.ts';
import { FeedChartSchema, FeedZhViewSchema } from '../feed-translation.ts';
import { REDDIT_SORTS } from '../reddit.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { NextOffsetSchema, OrNull, PageLimitSchema } from './lineage.ts';

export const FEED_PATH = `${API_PREFIX}/feed`;
export const FEED_REFRESH_PATH = `${FEED_PATH}/refresh`;
export { FeedRefreshSchema } from '../feed-refresh.ts';
export type { FeedRefresh } from '../feed-refresh.ts';
export const RefreshFeedRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type RefreshFeedRequest = Static<typeof RefreshFeedRequestSchema>;
export const FEED_ITEMS_PATH = `${FEED_PATH}/items`;
export const FEED_SOURCES_PATH = `${FEED_PATH}/sources`;
export const FEED_NAV_PATH = `${FEED_PATH}/nav`;
export const FEED_SUBSCRIPTIONS_PATH = `${FEED_SOURCES_PATH}/subscriptions`;
export const AddSubscriptionRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  url: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });
export type AddSubscriptionRequest = Static<typeof AddSubscriptionRequestSchema>;

export const FEED_ORIGIN_LABELS: Readonly<Record<FeedItem['origin'], string>> = {
  feed: '信息流',
  task: '任务',
  concern: '关切',
  manual: '手动添加',
};

export const RECENT_SITES_MAX = 20;

export const FeedAuthorViewSchema = Type.Object({
  name: Type.String(),
  handle: OrNull(Type.String()),
  avatar: OrNull(Type.String()),
});

export const FeedImageViewSchema = Type.Object({
  src: Type.String(),
  ratio: OrNull(Type.Number()),
});

export const FeedVideoViewSchema = Type.Object({
  kind: OrNull(Type.Enum(['video', 'images'])),
  durationSeconds: OrNull(Type.Number({ minimum: 0 })),
  stage: Type.Enum(['synced', 'previewed', 'transcribed', 'summarized']),
  points: Type.Array(Type.String()),
  related: Type.Array(Type.String()),
});
export type FeedVideoView = Static<typeof FeedVideoViewSchema>;

export const FeedItemViewSchema = Type.Object({
  id: IdSchema,
  origin: Type.Enum(FEED_ORIGINS),
  kind: Type.Enum(FEED_ITEM_KINDS),
  author: OrNull(FeedAuthorViewSchema),
  image: OrNull(FeedImageViewSchema),
  moreImages: Type.Array(FeedImageViewSchema, { maxItems: 3 }),
  originLabel: Type.String(),
  title: Type.String(),
  url: OrNull(Type.String()),
  site: OrNull(Type.String()),
  summary: Type.String(),
  why: Type.String(),
  topic: OrNull(Type.String()),
  concernId: OrNull(IdSchema),
  sourceId: IdSchema,
  sourceLabel: Type.String(),
  /** The object an internal item is about (`task:<id>`, `concern:<id>`). */
  ref: OrNull(Type.String()),
  day: Type.String(),
  arrivedAt: IsoTimeSchema,
  publishedAt: OrNull(IsoTimeSchema),
  reaction: OrNull(Type.Enum(FEED_REACTIONS)),
  saved: Type.Boolean(),
  note: OrNull(Type.String()),
  migrated: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
  zh: Type.Optional(OrNull(FeedZhViewSchema)),
  chart: Type.Optional(OrNull(FeedChartSchema)),
  video: Type.Optional(OrNull(FeedVideoViewSchema)),
  places: Type.Optional(Type.Array(Type.Enum(FEED_PLACES))),
  hasBody: Type.Optional(Type.Boolean()),
  body: Type.Optional(OrNull(Type.Array(FeedBlockSchema))),
});
export type FeedItemView = Static<typeof FeedItemViewSchema>;

export const FeedListQuerySchema = Type.Object(
  {
    day: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
    origin: Type.Optional(Type.Enum(FEED_ORIGINS)),
    includeHidden: Type.Optional(Type.Boolean()),
    saved: Type.Optional(Type.Boolean()),
    kind: Type.Optional(Type.Enum(FEED_FILTER_KINDS)),
    sourceId: Type.Optional(IdSchema),
    place: Type.Optional(Type.Enum(FEED_PLACES)),
    tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    limit: Type.Optional(PageLimitSchema),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type FeedListQuery = Static<typeof FeedListQuerySchema>;

export const FeedListResponseSchema = Type.Object({
  items: Type.Array(FeedItemViewSchema),
  nextOffset: NextOffsetSchema,
  newToday: Type.Integer({ minimum: 0 }),
});
export type FeedListResponse = Static<typeof FeedListResponseSchema>;

export const FeedSourceStatusViewSchema = Type.Object({
  checkedAt: IsoTimeSchema,
  okAt: OrNull(IsoTimeSchema),
  error: OrNull(Type.String()),
});

export const FeedSourceViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(FEED_SOURCE_KINDS),
  label: Type.String(),
  query: OrNull(Type.String()),
  searchTerms: Type.Array(Type.String()),
  level: Type.Enum(FEED_SOURCE_LEVELS),
  concernId: OrNull(IdSchema),
  ref: Type.Optional(Type.String()),
  status: Type.Optional(FeedSourceStatusViewSchema),
  migrated: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type FeedSourceView = Static<typeof FeedSourceViewSchema>;

export const FeedSourcesResponseSchema = Type.Object({
  interests: Type.Array(FeedSourceViewSchema),
  blocked: Type.Array(FeedSourceViewSchema),
  others: Type.Array(FeedSourceViewSchema),
  everyMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
  recentSites: Type.Array(Type.Object({ site: Type.String(), count: Type.Integer({ minimum: 1 }) })),
});
export type FeedSourcesResponse = Static<typeof FeedSourcesResponseSchema>;

export const AddFeedItemRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    title: Type.String({ minLength: 1, maxLength: 1_000 }),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: FEED_URL_MAX_CHARS })),
    summary: Type.Optional(Type.String({ maxLength: 20_000 })),
    why: Type.Optional(Type.String({ maxLength: 2_000 })),
    concernId: Type.Optional(IdSchema),
  },
  { additionalProperties: false },
);
export type AddFeedItemRequest = Static<typeof AddFeedItemRequestSchema>;

export const ReactFeedItemRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    reaction: Type.Union([Type.Enum(FEED_REACTIONS), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ReactFeedItemRequest = Static<typeof ReactFeedItemRequestSchema>;

export const SaveFeedItemRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), saved: Type.Boolean() },
  { additionalProperties: false },
);
export type SaveFeedItemRequest = Static<typeof SaveFeedItemRequestSchema>;

export const FeedItemResponseSchema = Type.Object({ item: FeedItemViewSchema });
export type FeedItemResponse = Static<typeof FeedItemResponseSchema>;

export const AddInterestRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    label: Type.String({ minLength: 1, maxLength: 200 }),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type AddInterestRequest = Static<typeof AddInterestRequestSchema>;
export const InterestResponseSchema = Type.Object({ source: FeedSourceViewSchema });
export type InterestResponse = Static<typeof InterestResponseSchema>;

export const SetSourceLevelRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), level: Type.Enum(FEED_SOURCE_LEVELS) },
  { additionalProperties: false },
);
export type SetSourceLevelRequest = Static<typeof SetSourceLevelRequestSchema>;
export const SetSourceQueryRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  query: Type.String({ minLength: 1, maxLength: 500, pattern: '\\S' }),
}, { additionalProperties: false });
export type SetSourceQueryRequest = Static<typeof SetSourceQueryRequestSchema>;
export const FeedSourceResponseSchema = Type.Object({ source: FeedSourceViewSchema });
export type FeedSourceResponse = Static<typeof FeedSourceResponseSchema>;

export const FEED_NAV_KINDS = ['news', 'x', 'xhs', 'douyin', 'reddit', 'rss'] as const;
export type FeedNavKind = (typeof FEED_NAV_KINDS)[number];
export const FEED_NAV_LABELS: Readonly<Record<FeedNavKind, string>> = {
  news: '兴趣',
  x: 'X',
  xhs: '小红书',
  douyin: '抖音收藏',
  reddit: 'Reddit',
  rss: '博客',
};
export const FEED_BUILT_IN_NAV_KINDS: readonly FeedNavKind[] = ['news', 'x', 'xhs', 'douyin'];
export const FeedNavQuerySchema = Type.Object({
  tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, { additionalProperties: false });
export const FeedNavSourceSchema = Type.Object({
  kind: Type.Enum(FEED_NAV_KINDS),
  label: Type.String(),
  source: FeedSourceViewSchema,
  count: Type.Integer({ minimum: 0 }),
  problem: OrNull(Type.String()),
  places: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
});
export type FeedNavSource = Static<typeof FeedNavSourceSchema>;
export const FeedNavResponseSchema = Type.Object({
  all: Type.Integer({ minimum: 0 }),
  sources: Type.Array(FeedNavSourceSchema),
});
export type FeedNavResponse = Static<typeof FeedNavResponseSchema>;

export const FEED_REDDIT_PATH = `${FEED_SOURCES_PATH}/reddit`;
export const AddRedditRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  subreddit: Type.String({ minLength: 1, maxLength: 200 }),
  sort: Type.Enum(REDDIT_SORTS),
}, { additionalProperties: false });
export type AddRedditRequest = Static<typeof AddRedditRequestSchema>;

export const FEED_REDDIT_PREVIEW_PATH = `${FEED_REDDIT_PATH}/preview`;
export const RedditPreviewQuerySchema = Type.Object({
  subreddit: Type.String({ minLength: 1, maxLength: 200 }),
  sort: Type.Enum(REDDIT_SORTS),
}, { additionalProperties: false });
export type RedditPreviewQuery = Static<typeof RedditPreviewQuerySchema>;
export const RedditPreviewPostSchema = Type.Object({
  title: Type.String(),
  url: Type.String(),
  author: OrNull(Type.String()),
  publishedAt: IsoTimeSchema,
});
export const RedditPreviewResponseSchema = Type.Object({
  subreddit: OrNull(Type.String()),
  posts: Type.Array(RedditPreviewPostSchema),
  error: OrNull(Type.String()),
});
export type RedditPreviewResponse = Static<typeof RedditPreviewResponseSchema>;

export const UpdateFeedSourceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' })),
  url: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  level: Type.Optional(Type.Enum(FEED_SOURCE_LEVELS)),
  sort: Type.Optional(Type.Enum(REDDIT_SORTS)),
}, { additionalProperties: false });
export type UpdateFeedSourceRequest = Static<typeof UpdateFeedSourceRequestSchema>;

export const RefreshFeedSourceRequestSchema = Type.Object({ requestId: RequestIdSchema },
  { additionalProperties: false });
export type RefreshFeedSourceRequest = Static<typeof RefreshFeedSourceRequestSchema>;
export const RefreshFeedSourceResponseSchema = Type.Object({
  source: FeedSourceViewSchema,
  added: Type.Integer({ minimum: 0 }),
});
export type RefreshFeedSourceResponse = Static<typeof RefreshFeedSourceResponseSchema>;

export const DeleteFeedSourceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type DeleteFeedSourceRequest = Static<typeof DeleteFeedSourceRequestSchema>;
