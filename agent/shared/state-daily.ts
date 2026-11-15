// M4 的共同状态（《实施方案》第 9 节 M4）：登记（关切完成标准的进度）、信息流的来源与条目、十件事、采访、
// 回来四句话、触发记录、在不在（离开多久）和每日设置。state/ 只存取；什么时候出卡、怎么拼四句由 attention/ 和 daily/
// 决定。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';
import { PreferredTimeZoneSchema } from './time-zone.ts';
import { FeedBannedTermsSchema } from './feed-search.ts';

const STRICT = { additionalProperties: false };

/** A local calendar day, `YYYY-MM-DD` (the 今日 of the user's time zone). */
export const DaySchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

// 登记（《UI 方案》第 7 节：登记 n/10 是一条可完成目标，完成标准「10 个陌生人登记」）。一次登记一行；「删除请求」也是
// 一行（withdrawal），所以旧版「登记数 − 删除请求数」的算法原样保留，谁也不改谁。
export const REGISTRATION_KINDS = ['signup', 'withdrawal'] as const;

// 信息流的来源（《UI 方案》第 9 节「Sources：关注点、不要的、最近来源」）。interest = 关注点，每个挂一条探索方向关切；
// internal = 站内（手动添加、「按关注点搜新闻」这个总开关；任务、关切两个站内来源 2026-11-04 起停收）；
// blocked_site = 不要的网站；rss = 订阅；x = X 上他关注的人（第 3 批 11-04：Mac 在线时读他登录着的「关注」时间线）；
// douyin = 抖音收藏（第 6 批第 9 条：他勾选处理、总结好的进信息流）；reddit = 一个 Reddit 版块（第 7 批第 13 条：
// 服务器直接取版块的 Atom，query 存那个地址，排序就在地址里）；xhs = 小红书（第13批：电脑客户端用他在 Plasticine
// 浏览器里的登录读首页「推荐」和自己的「收藏」）。
export const FEED_SOURCE_KINDS = [
  'interest', 'internal', 'blocked_site', 'rss', 'x', 'douyin', 'reddit', 'xhs',
] as const;
export const FEED_SOURCE_LEVELS = ['more', 'normal', 'less', 'off'] as const;
export const FeedSourceInputSchema = Type.Object(
  {
    kind: Type.Enum(FEED_SOURCE_KINDS),
    label: Type.String({ minLength: 1, maxLength: 200 }),
    query: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
    queryEdited: Type.Optional(Type.Boolean()),
    level: Type.Optional(Type.Enum(FEED_SOURCE_LEVELS)),
    concernId: Type.Optional(Nullable(IdSchema)),
    // A stable key for built-in and migrated sources (`internal:task`, `legacy:feed`): looked up instead of made twice.
    ref: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 300 }))),
  },
  STRICT,
);
export type FeedSourceInput = Static<typeof FeedSourceInputSchema>;
export const FeedSourcePatchSchema = Type.Partial(
  Type.Object({
    label: FeedSourceInputSchema.properties.label,
    query: Nullable(Type.String({ maxLength: 500 })),
    queryEdited: Type.Boolean(),
    level: Type.Enum(FEED_SOURCE_LEVELS),
    concernId: Nullable(IdSchema),
  }),
  STRICT,
);
export type FeedSourcePatch = Static<typeof FeedSourcePatchSchema>;
export const FeedSourceSchema = Type.Object({ ...OBJECT_META, ...Type.Required(FeedSourceInputSchema).properties });
export type FeedSource = Static<typeof FeedSourceSchema>;

// 信息流条目。反应：赞 / 不感兴趣（like / dislike，不感兴趣的不再显示）、收藏（savedAt）；条目的点评在 note。
export const FEED_ORIGINS = ['feed', 'task', 'concern', 'manual'] as const;
/**
 * 信息流里列出、计数的只有站外收集的和手动添加的（2026-11-04 用户定：信息流像自己的瀑布流推特，只放感兴趣的站外资讯）。
 * task / concern 是以前站内扫描写的（做完的任务、项目新添 / 了结），不再收；旧行留着，靠这里过滤。
 */
export const FEED_LIST_ORIGINS = ['feed', 'manual'] as const satisfies readonly (typeof FEED_ORIGINS)[number][];
export const FEED_REACTIONS = ['like', 'dislike'] as const;
/**
 * 第 3 批：一条信息流从哪一路来——X 上他关注的人、订阅、按关注点搜的新闻、手动添加。由来源的种类推出来，不单存：
 * x → x，rss → rss，reddit → reddit，手动添加 → manual，其余站外收集的（关注点搜索、迁移来的旧条目）→ news。
 * 页头分段按它筛（不含 manual）。
 */
export const FEED_ITEM_KINDS = ['x', 'rss', 'news', 'manual', 'douyin', 'reddit', 'xhs'] as const;
export const FEED_FILTER_KINDS = ['x', 'rss', 'news', 'douyin', 'reddit', 'xhs'] as const satisfies
  readonly (typeof FEED_ITEM_KINDS)[number][];
/**
 * 第13批：一条是在那一路的哪一处看到的——X 的「正在关注」「为你推荐」「书签」，小红书的「推荐」「收藏」。同一条在两处都
 * 看到就两个都记（卡片上两个标）。订阅、Reddit、抖音没有这一说，是空的。
 */
export const FEED_PLACES = ['following', 'recommend', 'bookmark', 'saved'] as const;
export type FeedPlace = (typeof FEED_PLACES)[number];
export const FEED_PLACE_LABELS: Readonly<Record<FeedPlace, string>> = {
  following: '关注', recommend: '推荐', bookmark: '书签', saved: '收藏',
};
/** 订阅文章的全文（第13批）：一段段存，不存 HTML——段落、小标题、引用、列表项、代码、图。 */
export const FEED_BLOCK_TYPES = ['p', 'h', 'quote', 'li', 'code', 'img'] as const;
export const FeedBlockSchema = Type.Object({
  t: Type.Enum(FEED_BLOCK_TYPES),
  /** 文字（图是图注，可以是空的）。 */
  text: Type.String({ maxLength: 20_000 }),
  /** 图的地址（只要 https）。 */
  src: Type.Optional(Type.String({ pattern: '^https://', maxLength: 3_000 })),
}, { additionalProperties: false });
export type FeedBlock = Static<typeof FeedBlockSchema>;
export const FEED_BODY_MAX_BLOCKS = 400;
// 旧信息流的长摘要完整保留，最多 100 000 字符。
export const FEED_TEXT_MAX_CHARS = 100_000;
export const FEED_URL_MAX_CHARS = 3_000;
// 第 3 批瀑布流卡片：配图的宽高比只用来先占好位置（图载入前后卡片不跳），放宽到 0.2–5，越界的按没有比例处理。
export const FEED_IMAGE_RATIO_MIN = 0.2;
export const FEED_IMAGE_RATIO_MAX = 5;
const FeedImageLinkSchema = Type.String({ pattern: '^https://', maxLength: FEED_URL_MAX_CHARS });
/** 封面以外的图最多几张（11-14 只有 X 的帖子带，一条最多四张）。 */
export const FEED_MORE_IMAGES_MAX = 3;
export const FeedImageSchema = Type.Object({
  url: FeedImageLinkSchema,
  ratio: Nullable(Type.Number({ minimum: FEED_IMAGE_RATIO_MIN, maximum: FEED_IMAGE_RATIO_MAX })),
}, STRICT);
export type FeedImage = Static<typeof FeedImageSchema>;
export const FeedItemInputSchema = Type.Object(
  {
    sourceId: IdSchema,
    origin: Type.Enum(FEED_ORIGINS),
    title: Type.String({ minLength: 1, maxLength: 1_000 }),
    url: Type.Optional(Nullable(Type.String({ pattern: '^https?://', maxLength: FEED_URL_MAX_CHARS }))),
    site: Type.Optional(Nullable(Type.String({ maxLength: 1_000 }))),
    summary: Type.Optional(Type.String({ maxLength: FEED_TEXT_MAX_CHARS })),
    why: Type.Optional(Type.String({ maxLength: 30_000 })),
    topic: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    concernId: Type.Optional(Nullable(IdSchema)),
    // The object an internal item is about (`task:<id>`), for 「点开」.
    ref: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 300 }))),
    // One item per thing that happened: adding the same thing again returns the item already there.
    dedupeKey: Type.String({ minLength: 1, maxLength: 300 }),
    day: DaySchema,
    publishedAt: Type.Optional(Nullable(IsoTimeSchema)),
    arrivedAt: IsoTimeSchema,
    // 第 3 批：作者（X 的帖子；订阅文章有作者也记），头像和配图存原图网址，给界面时换成服务端代理地址。
    author: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 200 }))),
    authorHandle: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 100 }))),
    avatarUrl: Type.Optional(Nullable(FeedImageLinkSchema)),
    imageUrl: Type.Optional(Nullable(FeedImageLinkSchema)),
    imageRatio: Type.Optional(Nullable(Type.Number({ minimum: FEED_IMAGE_RATIO_MIN, maximum: FEED_IMAGE_RATIO_MAX }))),
    // 11-14 图片统一：封面（imageUrl）以外的图，按顺序；只有 X 的帖子有。
    moreImages: Type.Optional(Type.Array(FeedImageSchema, { maxItems: FEED_MORE_IMAGES_MAX })),
    // 第13批：在哪一处看到的（X、小红书）；订阅文章的全文。
    places: Type.Optional(Type.Array(Type.Enum(FEED_PLACES), { maxItems: FEED_PLACES.length })),
    body: Type.Optional(Nullable(Type.Array(FeedBlockSchema, { maxItems: FEED_BODY_MAX_BLOCKS }))),
  },
  STRICT,
);
export type FeedItemInput = Static<typeof FeedItemInputSchema>;
export const FeedItemPatchSchema = Type.Partial(
  Type.Object({
    // Import recovery and attribution corrections keep the source, topic and concern consistent.
    sourceId: IdSchema,
    topic: Nullable(Type.String({ maxLength: 200 })),
    reaction: Nullable(Type.Enum(FEED_REACTIONS)),
    savedAt: Nullable(IsoTimeSchema),
    note: Nullable(Type.String({ maxLength: 10_000 })),
    seenAt: Nullable(IsoTimeSchema),
    concernId: Nullable(IdSchema),
    // 第13批：同一条又在另一处看到（关注里有、后来进了书签）就把那一处并进来；以前没存全文的再抓到时补上。
    places: Type.Array(Type.Enum(FEED_PLACES), { maxItems: FEED_PLACES.length }),
    body: Nullable(Type.Array(FeedBlockSchema, { maxItems: FEED_BODY_MAX_BLOCKS })),
    // 11-14 起存原链接：以前存的是洗过的（比如小红书笔记少了 xsec_token），再抓到时换成原链接。
    url: Nullable(Type.String({ pattern: '^https?://', maxLength: FEED_URL_MAX_CHARS })),
    // 11-14 图片统一：以前只存了封面的 X 帖子，再看到时补上别的图。
    moreImages: Type.Array(FeedImageSchema, { maxItems: FEED_MORE_IMAGES_MAX }),
  }),
  STRICT,
);
export type FeedItemPatch = Static<typeof FeedItemPatchSchema>;
export const FeedItemSchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(FeedItemInputSchema).properties,
  ...Type.Required(FeedItemPatchSchema).properties,
});
export type FeedItem = Static<typeof FeedItemSchema>;

// 十件事（《UI 方案》第 3 节：与你有关的变化、看过计数、差异待核对；「十件事」是名字不是上限，默认 20 条）。类别的先后照
// 1ca0391 daily.ts：待决 > 目标变化 > 值得一提 > 信息对齐。
export const BRIEF_CATEGORIES = ['decision', 'goal_change', 'noteworthy', 'alignment'] as const;
export const BRIEF_REF_TYPES = ['ask', 'task', 'concern', 'judgment', 'agreement', 'registration'] as const;

// 回来四句话（《从零方案》第 5 节、《UI 方案》第 4 节）：哪些问题没新证据保留了（→ 关切）· 哪个判断因为什么变了（→ 判断）·
// 约定的工作推到哪里（→ 任务）· 有没有新联系（→ 它带回的条目）。
export const RETURN_SENTENCE_KEYS = ['kept', 'changed', 'progressed', 'connections'] as const;
export const RETURN_TARGET_VIEWS = ['concerns', 'judgments', 'tasks', 'feed'] as const;
export const RETURN_BRIEF_STATUSES = ['composing', 'ready'] as const;

/** The last time the user did something in the app (any device). */
export const PresenceSchema = Type.Object(
  { lastActiveAt: IsoTimeSchema, deviceId: Nullable(IdSchema), updatedAt: IsoTimeSchema },
  STRICT,
);
export type Presence = Static<typeof PresenceSchema>;

// 每日设置：十件事上限（1ca0391 daily.ts：默认 20，1–100）、离开多久算「回来」（《UI 方案》第 4 节：默认 4 小时，设置里改）、
// 采访（1ca0391 interview.ts：默认关着，每天 3 题）。
export const BRIEF_LIMIT_DEFAULT = 20;
export const BRIEF_LIMIT_MAX = 100;
export const RETURN_THRESHOLD_HOURS_DEFAULT = 4;
export const RETURN_THRESHOLD_HOURS_MAX = 7 * 24;
export const INTERVIEW_PER_DAY_DEFAULT = 3;
export const INTERVIEW_PER_DAY_MAX = 20;
export const DailySettingsSchema = Type.Object(
  {
    timeZone: PreferredTimeZoneSchema,
    feedBannedTerms: FeedBannedTermsSchema,
    briefLimit: Type.Integer({ minimum: 1, maximum: BRIEF_LIMIT_MAX }),
    returnThresholdHours: Type.Number({ minimum: 0.25, maximum: RETURN_THRESHOLD_HOURS_MAX }),
    interviewEnabled: Type.Boolean(),
    collisionEnabled: Type.Optional(Type.Boolean()),
    cognitionReviewEnabled: Type.Optional(Type.Boolean()),
    interviewPerDay: Type.Integer({ minimum: 1, maximum: INTERVIEW_PER_DAY_MAX }),
  },
  STRICT,
);
export type DailySettings = Static<typeof DailySettingsSchema>;
export const DailySettingsPatchSchema = Type.Partial(DailySettingsSchema, { ...STRICT, minProperties: 1 });
export type DailySettingsPatch = Static<typeof DailySettingsPatchSchema>;
export const DAILY_SETTINGS_DEFAULTS: DailySettings = {
  briefLimit: BRIEF_LIMIT_DEFAULT,
  returnThresholdHours: RETURN_THRESHOLD_HOURS_DEFAULT,
  interviewEnabled: false,
  interviewPerDay: INTERVIEW_PER_DAY_DEFAULT,
};
export const DailySettingsRowSchema = Type.Object({
  value: DailySettingsSchema,
  version: Type.Integer({ minimum: 1 }),
  updatedAt: IsoTimeSchema,
  migratedDefault: Type.Boolean(),
  legacyPayload: Nullable(Type.Unknown()),
});
export type DailySettingsRow = Static<typeof DailySettingsRowSchema>;
