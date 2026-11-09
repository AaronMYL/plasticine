// /v2/spaces、/v2/subscriptions、/v2/review（《优化清单》第 6、7 条，11-06 定）：
// - 空间：列表（资料库第二栏「空间」、资料库首页的缩略图）、读一个、他在页面上直接改字、改名、撤销最近一版。
//   第 8 批第 6 条（11-09）起空间是整页网页：html 是 body 里的正文片段，genre 是报告 / 来信；还没重写成网页的旧空间
//   html 是 null，照旧按 doc 显示。笔记的续写、补充在空间里不再用。
// - 订阅：列表（信息流第二栏「订阅」、顶部最新一期）、一个订阅（最新一期 / 往期 / 设置）、改设置、开定时 / 暂停、
//   「以后都这样」、现在出一期。
// - 回顾：首页「现在」的「回顾」一节（最近一期个人回顾的一句、昨晚整理了几条）。

import { Type, type Static } from 'typebox';
import {
  SPACE_EDITIONS,
  SPACE_GENRES,
  SPACE_HTML_MAX_CHARS,
  SPACE_TITLE_MAX_CHARS,
  SPACE_AUTHORS,
  SpaceDocSchema,
  SpaceStatSchema,
  SubscriptionSettingsSchema,
  SUBSCRIPTION_KINDS,
  SUBSCRIPTION_STATUSES,
} from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const SPACES_PATH = `${API_PREFIX}/spaces`;
export const SUBSCRIPTIONS_PATH = `${API_PREFIX}/subscriptions`;
export const REVIEW_PATH = `${API_PREFIX}/review`;

const STRICT = { additionalProperties: false };
const Edition = OrNull(Type.Enum(SPACE_EDITIONS));
const Genre = OrNull(Type.Enum(SPACE_GENRES));

/** 空间是什么来路：一般空间、研究周报的一期、个人回顾的一期。界面按它选图标。 */
export const SPACE_KINDS = ['space', 'research', 'review'] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const SpaceListItemSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  kind: Type.Enum(SPACE_KINDS),
  /** 报告 / 来信；旧版式还没重写是 null。 */
  genre: Genre,
  author: Type.Enum(SPACE_AUTHORS),
  subscriptionId: OrNull(IdSchema),
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
  edition: Edition,
  /** 正文这一版是第几版：缩略图按它认缓存。 */
  version: Type.Integer({ minimum: 1 }),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
}, STRICT);
export type SpaceListItem = Static<typeof SpaceListItemSchema>;
export const SpaceListResponseSchema = Type.Object({ spaces: Type.Array(SpaceListItemSchema) }, STRICT);
export type SpaceListResponse = Static<typeof SpaceListResponseSchema>;

/** 最近一版是 Plasticine 改的、带着「改了什么」：页底那条「这一期改好了…… 以后都这样 / 撤销」。 */
export const SpaceChangeSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  change: Type.String(),
  rule: OrNull(Type.String()),
  /** 订阅里已经有这条规则（点过了）。 */
  adopted: Type.Boolean(),
}, STRICT);
export type SpaceChange = Static<typeof SpaceChangeSchema>;

export const SpaceViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  version: Type.Integer({ minimum: 1 }),
  kind: Type.Enum(SPACE_KINDS),
  genre: Genre,
  author: Type.Enum(SPACE_AUTHORS),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  /** 网页正文（body 里的片段，清洗过）；旧版式还没重写是 null，这时按 doc 显示。 */
  html: OrNull(Type.String()),
  doc: SpaceDocSchema,
  subscription: OrNull(Type.Object({ id: IdSchema, title: Type.String(), version: Type.Integer({ minimum: 1 }) },
    STRICT)),
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
  edition: Edition,
  lastChange: OrNull(SpaceChangeSchema),
}, STRICT);
export type SpaceView = Static<typeof SpaceViewSchema>;

/** PUT /v2/spaces/:id：改名只给 title；在页面上改字给 html（整页正文片段，服务端再清洗一遍）。 */
export const SaveSpaceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS })),
  html: Type.Optional(Type.String({ minLength: 1, maxLength: SPACE_HTML_MAX_CHARS })),
}, STRICT);
export type SaveSpaceRequest = Static<typeof SaveSpaceRequestSchema>;

export const UndoSpaceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
}, STRICT);
export type UndoSpaceRequest = Static<typeof UndoSpaceRequestSchema>;

/** DELETE /v2/spaces/:id：移到「最近删除」（只打删除时间，能还原），带 version。 */
export const DeleteSpaceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
}, STRICT);
export type DeleteSpaceRequest = Static<typeof DeleteSpaceRequestSchema>;

/** POST /v2/spaces/:id/restore：从「最近删除」还原。 */
export const RestoreSpaceRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type RestoreSpaceRequest = Static<typeof RestoreSpaceRequestSchema>;

/** GET /v2/spaces?standalone=true：只要不属于订阅的空间（资料库第二栏「空间」一组；各期在订阅页里）。 */
export const SPACE_LIST_STANDALONE_PARAM = 'standalone';

/** 一期的简报：信息流顶部、订阅的往期、首页回顾都用它。 */
export const IssueBriefSchema = Type.Object({
  spaceId: IdSchema,
  subscriptionId: IdSchema,
  issueNumber: Type.Integer({ minimum: 1 }),
  edition: Edition,
  /** 来信 / 报告（第 8 批第 6 条）；旧版式和旧客户端缓存里没有。 */
  genre: Type.Optional(Genre),
  title: Type.String(),
  headline: Type.String(),
  stats: Type.Array(SpaceStatSchema),
  createdAt: IsoTimeSchema,
}, STRICT);
export type IssueBrief = Static<typeof IssueBriefSchema>;

export const SubscriptionListItemSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  kind: Type.Enum(SUBSCRIPTION_KINDS),
  status: Type.Enum(SUBSCRIPTION_STATUSES),
  latest: OrNull(IssueBriefSchema),
  issueCount: Type.Integer({ minimum: 0 }),
}, STRICT);
export type SubscriptionListItem = Static<typeof SubscriptionListItemSchema>;
export const SubscriptionListResponseSchema = Type.Object({ subscriptions: Type.Array(SubscriptionListItemSchema) },
  STRICT);
export type SubscriptionListResponse = Static<typeof SubscriptionListResponseSchema>;

export const SubscriptionViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  kind: Type.Enum(SUBSCRIPTION_KINDS),
  status: Type.Enum(SUBSCRIPTION_STATUSES),
  version: Type.Integer({ minimum: 1 }),
  settings: SubscriptionSettingsSchema,
  timeZone: Type.String(),
  lastRunAt: OrNull(IsoTimeSchema),
  /** 下一次什么时候出（没开定时是 null）。 */
  nextRunAt: OrNull(IsoTimeSchema),
  issues: Type.Array(IssueBriefSchema),
}, STRICT);
export type SubscriptionView = Static<typeof SubscriptionViewSchema>;

export const UpdateSubscriptionRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS })),
  settings: Type.Optional(SubscriptionSettingsSchema),
  status: Type.Optional(Type.Enum(['active', 'paused'])),
}, STRICT);
export type UpdateSubscriptionRequest = Static<typeof UpdateSubscriptionRequestSchema>;

/** 「以后都这样」：把这一期那一版上的规则写进订阅设置。 */
export const AdoptRuleRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  spaceId: IdSchema,
  spaceVersion: Type.Integer({ minimum: 1 }),
}, STRICT);
export type AdoptRuleRequest = Static<typeof AdoptRuleRequestSchema>;

export const RunSubscriptionRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  edition: Type.Optional(Type.Enum(SPACE_EDITIONS)),
}, STRICT);
export type RunSubscriptionRequest = Static<typeof RunSubscriptionRequestSchema>;
export const RunSubscriptionResponseSchema = Type.Object({ lineId: IdSchema }, STRICT);
export type RunSubscriptionResponse = Static<typeof RunSubscriptionResponseSchema>;

/** 首页「回顾」：最近一期个人回顾、昨晚整理了几条（没有就是 null，那一行不出现）。 */
export const ReviewSummarySchema = Type.Object({
  latest: OrNull(IssueBriefSchema),
  dream: OrNull(Type.Object({
    finishedAt: IsoTimeSchema,
    total: Type.Integer({ minimum: 0 }),
    add: Type.Integer({ minimum: 0 }),
    replace: Type.Integer({ minimum: 0 }),
    unsure: Type.Integer({ minimum: 0 }),
  }, STRICT)),
}, STRICT);
export type ReviewSummary = Static<typeof ReviewSummarySchema>;
