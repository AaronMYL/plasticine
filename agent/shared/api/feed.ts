// /v2/feed: 信息流页（《UI 方案》第 9 节）——今天的新消息（赞 / 不感兴趣 / 收藏），信息源（关注点、不要的、最近来源）。
// 「为什么推给你」在条目展开里。每个关注点在关切板里是一条探索方向，它带回的
// 条目挂在那条下面。外部搜索与订阅共用每日七点收集，手动刷新只追加新条目。

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
/** 第 3 批：他只给网址，名字可以不给（用订阅源自己的名字，再没有就用网站名）。 */
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

/** 信息源的「最近来源」列几个网站。 */
export const RECENT_SITES_MAX = 20;

/** 第 3 批卡片的作者：X 的帖子是发帖的人（头像是服务端代理地址），订阅文章有作者也给。 */
export const FeedAuthorViewSchema = Type.Object({
  name: Type.String(),
  handle: OrNull(Type.String()),
  avatar: OrNull(Type.String()),
});
export type FeedAuthorView = Static<typeof FeedAuthorViewSchema>;

/** 配图：src 是服务端代理地址（外部图片不直连，对方看不到他的 IP）；ratio = 高 / 宽，知道就先占好位置。 */
export const FeedImageViewSchema = Type.Object({
  src: Type.String(),
  ratio: OrNull(Type.Number()),
});
export type FeedImageView = Static<typeof FeedImageViewSchema>;

export const FeedVideoViewSchema = Type.Object({
  kind: OrNull(Type.Enum(['video', 'images'])),
  durationSeconds: OrNull(Type.Number({ minimum: 0 })),
  stage: Type.Enum(['synced', 'previewed', 'transcribed', 'summarized']),
  /** 核心观点（卡片上列出来）。 */
  points: Type.Array(Type.String()),
  /** 和他兴趣有关的重点。 */
  related: Type.Array(Type.String()),
});
export type FeedVideoView = Static<typeof FeedVideoViewSchema>;

export const FeedItemViewSchema = Type.Object({
  id: IdSchema,
  origin: Type.Enum(FEED_ORIGINS),
  /** 从哪一路来：X / 订阅 / 新闻 / 手动添加（shared/state-daily.ts FEED_ITEM_KINDS）。 */
  kind: Type.Enum(FEED_ITEM_KINDS),
  author: OrNull(FeedAuthorViewSchema),
  image: OrNull(FeedImageViewSchema),
  originLabel: Type.String(),
  title: Type.String(),
  url: OrNull(Type.String()),
  site: OrNull(Type.String()),
  summary: Type.String(),
  /** 为什么推给你（条目展开里）。 */
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
  /** 第 8 条：抓取时存下的中文（译文、长帖的中文摘要）。旧回执里没有。 */
  zh: Type.Optional(OrNull(FeedZhViewSchema)),
  /** 第 8 条：只用文章里明写的数字画的小图表；没有就是 null。 */
  chart: Type.Optional(OrNull(FeedChartSchema)),
  /** 第 9 条：抖音收藏总结来的条目——视频多长、图文还是视频、走到哪了。 */
  video: Type.Optional(OrNull(FeedVideoViewSchema)),
  /** 第13批：在哪一处看到的（X 的关注 / 推荐 / 书签，小红书的推荐 / 收藏），卡片上一处一个标。 */
  places: Type.Optional(Type.Array(Type.Enum(FEED_PLACES))),
  /** 第13批：有没有存下的全文（订阅文章）；有就点开读全文。 */
  hasBody: Type.Optional(Type.Boolean()),
  /** 全文只在读一条（GET /v2/feed/items/:id）时给，列表里不带。 */
  body: Type.Optional(OrNull(Type.Array(FeedBlockSchema))),
});
export type FeedItemView = Static<typeof FeedItemViewSchema>;

/**
 * GET /v2/feed?day=&origin=&includeHidden=&saved=&kind=&limit=&offset= — newest first; 不感兴趣的不在里面，除非 includeHidden；
 * saved = true 只列信息流收藏（2026-11-04：信息流收藏归信息流，和书签分开）。
 */
export const FeedListQuerySchema = Type.Object(
  {
    day: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
    origin: Type.Optional(Type.Enum(FEED_ORIGINS)),
    includeHidden: Type.Optional(Type.Boolean()),
    saved: Type.Optional(Type.Boolean()),
    /** 第 3 批页头分段：X · 订阅 · 新闻；不给就是全部。 */
    kind: Type.Optional(Type.Enum(FEED_FILTER_KINDS)),
    /** 第 7 批第 10 条：只看这一个来源（第二栏的一个订阅 / Reddit 版块）。 */
    sourceId: Type.Optional(IdSchema),
    /** 第13批：只看在这一处看到的（X、小红书的筛选）。 */
    place: Type.Optional(Type.Enum(FEED_PLACES)),
    tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    limit: Type.Optional(PageLimitSchema),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type FeedListQuery = Static<typeof FeedListQuerySchema>;

/** `newToday`: 「信息流 n 条新的」 of the user's day. */
export const FeedListResponseSchema = Type.Object({
  items: Type.Array(FeedItemViewSchema),
  nextOffset: NextOffsetSchema,
  newToday: Type.Integer({ minimum: 0 }),
});
export type FeedListResponse = Static<typeof FeedListResponseSchema>;

/** 来源最近一次抓 / 读的结果（设置里「信息流来源」那一行写出错原因）。 */
export const FeedSourceStatusViewSchema = Type.Object({
  checkedAt: IsoTimeSchema,
  okAt: OrNull(IsoTimeSchema),
  error: OrNull(Type.String()),
});
export type FeedSourceStatusView = Static<typeof FeedSourceStatusViewSchema>;

export const FeedSourceViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(FEED_SOURCE_KINDS),
  label: Type.String(),
  query: OrNull(Type.String()),
  searchTerms: Type.Array(Type.String()),
  level: Type.Enum(FEED_SOURCE_LEVELS),
  /** The 探索方向 a 关注点 is in the concern board. */
  concernId: OrNull(IdSchema),
  /** 内置来源的稳定标识（`x:following`、`internal:news`）；他加的订阅和关注点不给。 */
  ref: Type.Optional(Type.String()),
  /** 还没抓 / 读过就没有。 */
  status: Type.Optional(FeedSourceStatusViewSchema),
  migrated: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type FeedSourceView = Static<typeof FeedSourceViewSchema>;

/**
 * GET /v2/feed/sources — 关注点 · 不要的 · 最近来源 (站内来源在 `others`)。第 3 批：`others` 里有 X、订阅和
 * 「按关注点搜新闻」（设置里「信息流来源」一节按它们各列一行），`everyMinutes` 是订阅和 X 多久抓 / 读一次。
 */
export const FeedSourcesResponseSchema = Type.Object({
  interests: Type.Array(FeedSourceViewSchema),
  blocked: Type.Array(FeedSourceViewSchema),
  others: Type.Array(FeedSourceViewSchema),
  everyMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
  recentSites: Type.Array(Type.Object({ site: Type.String(), count: Type.Integer({ minimum: 1 }) })),
});
export type FeedSourcesResponse = Static<typeof FeedSourcesResponseSchema>;

/**
 * POST /v2/feed/items → 201 { item }: 手动添加一条信息流条目。The link must be http(s) without a user name or password;
 * query parameters that look like credentials (token, key, secret …) are dropped before it is stored.
 */
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

/** POST /v2/feed/items/:id/reaction → 200 { item }: 赞 / 不感兴趣 / 取消（null）。 */
export const ReactFeedItemRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    reaction: Type.Union([Type.Enum(FEED_REACTIONS), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ReactFeedItemRequest = Static<typeof ReactFeedItemRequestSchema>;

/**
 * POST /v2/feed/items/:id/save → 200 { item }: 收藏 / 取消收藏。第 110 条起收藏就是加书签：服务端同时加一条
 * origin = feed 的书签（项目跟着条目），取消收藏移除它；收藏过的在书签页看，信息流不再单留收藏列表。
 */
export const SaveFeedItemRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), saved: Type.Boolean() },
  { additionalProperties: false },
);
export type SaveFeedItemRequest = Static<typeof SaveFeedItemRequestSchema>;

export const FeedItemResponseSchema = Type.Object({ item: FeedItemViewSchema });
export type FeedItemResponse = Static<typeof FeedItemResponseSchema>;

/** POST /v2/feed/sources → 201 { source, concern }: 加一个关注点，同时在关切板上开一条探索方向。 */
export const AddInterestRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    label: Type.String({ minLength: 1, maxLength: 200 }),
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type AddInterestRequest = Static<typeof AddInterestRequestSchema>;
/** 2026-11-05 关切删掉：加关注点只回来源。 */
export const InterestResponseSchema = Type.Object({ source: FeedSourceViewSchema });
export type InterestResponse = Static<typeof InterestResponseSchema>;

/** POST /v2/feed/sources/:id/level → 200 { source }: 多 / 正常 / 少 / 关掉（关掉不删，探索方向关切照旧）。 */
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

/**
 * 第 7 批第 10 条（他定）：信息流的第二栏——顶上「全部」「收藏」，下面「来源」每个来源一行：X 关注、抖音收藏、按关注点的
 * 新闻（内置三种），每个订阅、每个 Reddit 版块各一行。个数是今天新来的（他的时区），「全部」= 各来源之和再加手动添加的。
 */
export const FEED_NAV_KINDS = ['news', 'x', 'xhs', 'douyin', 'reddit', 'rss'] as const;
export type FeedNavKind = (typeof FEED_NAV_KINDS)[number];
/** 第13批（11-14 Aaron）：「X 关注」改「X」，「按关注点的新闻」改「兴趣」，加「小红书」；订阅叫「博客」。 */
export const FEED_NAV_LABELS: Readonly<Record<FeedNavKind, string>> = {
  news: '兴趣',
  x: 'X',
  xhs: '小红书',
  douyin: '抖音收藏',
  reddit: 'Reddit',
  rss: '博客',
};
/** 内置的四种：没有删除。 */
export const FEED_BUILT_IN_NAV_KINDS: readonly FeedNavKind[] = ['news', 'x', 'xhs', 'douyin'];
export const FeedNavQuerySchema = Type.Object({
  tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, { additionalProperties: false });
export type FeedNavQuery = Static<typeof FeedNavQuerySchema>;
export const FeedNavSourceSchema = Type.Object({
  kind: Type.Enum(FEED_NAV_KINDS),
  /** 名字：内置的用固定名字，订阅用他起的（或订阅源自己的），Reddit 是 r/版块。 */
  label: Type.String(),
  /** 这一行的来源（内置的也有一行：X、抖音收藏、「按关注点搜新闻」的总开关）；暂停就是 level = off。 */
  source: FeedSourceViewSchema,
  /** 今天新来的条数。 */
  count: Type.Integer({ minimum: 0 }),
  /** 上次没取到的原因（行尾小红点，悬停看）；抖音是同步的状态（等电脑上线、没做成）。没有就是 null。 */
  problem: OrNull(Type.String()),
  /** 第13批：X、小红书今天新来的按在哪一处看到的数（筛选上的数）；别的来源没有。 */
  places: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
});
export type FeedNavSource = Static<typeof FeedNavSourceSchema>;
export const FeedNavResponseSchema = Type.Object({
  all: Type.Integer({ minimum: 0 }),
  sources: Type.Array(FeedNavSourceSchema),
});
export type FeedNavResponse = Static<typeof FeedNavResponseSchema>;

/** POST /v2/feed/sources/reddit → 201 { source }：加一个 Reddit 版块（第 7 批第 13 条），服务器直接取，不用登录。 */
export const FEED_REDDIT_PATH = `${FEED_SOURCES_PATH}/reddit`;
export const AddRedditRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  subreddit: Type.String({ minLength: 1, maxLength: 200 }),
  sort: Type.Enum(REDDIT_SORTS),
}, { additionalProperties: false });
export type AddRedditRequest = Static<typeof AddRedditRequestSchema>;

/** GET /v2/feed/sources/reddit/preview?subreddit=&sort= — 加之前看最新几条（服务端代取）；取不到给原因。 */
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
export type RedditPreviewPost = Static<typeof RedditPreviewPostSchema>;
export const RedditPreviewResponseSchema = Type.Object({
  /** 认出来的版块名（他填的网址、r/ 前缀都去掉了）；认不出是 null。 */
  subreddit: OrNull(Type.String()),
  posts: Type.Array(RedditPreviewPostSchema),
  /** 取不到的原因（版块不存在、限流、网络）；取到了是 null。 */
  error: OrNull(Type.String()),
});
export type RedditPreviewResponse = Static<typeof RedditPreviewResponseSchema>;

/**
 * POST /v2/feed/sources/:id/settings → 200 { source }：改一个来源（第 7 批第 10 条「设置…」）。订阅：名字、网址、档位；
 * Reddit：排序（和档位）。只给要改的。
 */
export const UpdateFeedSourceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' })),
  url: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  level: Type.Optional(Type.Enum(FEED_SOURCE_LEVELS)),
  sort: Type.Optional(Type.Enum(REDDIT_SORTS)),
}, { additionalProperties: false });
export type UpdateFeedSourceRequest = Static<typeof UpdateFeedSourceRequestSchema>;

/** POST /v2/feed/sources/:id/refresh → 200 { source, added }：现在刷新这一个（订阅、Reddit 马上取；X 记成到点）。 */
export const RefreshFeedSourceRequestSchema = Type.Object({ requestId: RequestIdSchema },
  { additionalProperties: false });
export type RefreshFeedSourceRequest = Static<typeof RefreshFeedSourceRequestSchema>;
export const RefreshFeedSourceResponseSchema = Type.Object({
  source: FeedSourceViewSchema,
  added: Type.Integer({ minimum: 0 }),
});
export type RefreshFeedSourceResponse = Static<typeof RefreshFeedSourceResponseSchema>;

/**
 * POST /v2/feed/sources/:id/delete → 200 { source }：删掉一个订阅 / Reddit 版块（内置的不能删）。不再抓；它没收藏过的
 * 条目从信息流拿掉，收藏过的留在「收藏」里；再加同一个地址会找回来。
 */
export const DeleteFeedSourceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type DeleteFeedSourceRequest = Static<typeof DeleteFeedSourceRequestSchema>;
