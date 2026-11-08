// /v2/spaces、/v2/subscriptions、/v2/review（《优化清单》第 6、7 条，11-06 定）：
// - 空间：列表（资料库第二栏「空间」）、读一个、他直接改、撤销最近一版、笔记 AI 的续写和补充。
// - 订阅：列表（信息流第二栏「订阅」、顶部最新一期）、一个订阅（最新一期 / 往期 / 设置）、改设置、开定时 / 暂停、
//   「以后都这样」、现在出一期。
// - 回顾：首页「现在」的「回顾」一节（最近一期个人回顾的一句、昨晚整理了几条）。

import { Type, type Static } from 'typebox';
import {
  SPACE_EDITIONS,
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

/** 空间是什么来路：一般空间、研究周报的一期、个人回顾的一期。界面按它选图标。 */
export const SPACE_KINDS = ['space', 'research', 'review'] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const SpaceListItemSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  kind: Type.Enum(SPACE_KINDS),
  author: Type.Enum(SPACE_AUTHORS),
  subscriptionId: OrNull(IdSchema),
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
  edition: Edition,
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
  author: Type.Enum(SPACE_AUTHORS),
  updatedAt: IsoTimeSchema,
  doc: SpaceDocSchema,
  subscription: OrNull(Type.Object({ id: IdSchema, title: Type.String(), version: Type.Integer({ minimum: 1 }) },
    STRICT)),
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
  edition: Edition,
  lastChange: OrNull(SpaceChangeSchema),
}, STRICT);
export type SpaceView = Static<typeof SpaceViewSchema>;

export const SaveSpaceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS })),
  doc: SpaceDocSchema,
}, STRICT);
export type SaveSpaceRequest = Static<typeof SaveSpaceRequestSchema>;

export const UndoSpaceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
}, STRICT);
export type UndoSpaceRequest = Static<typeof UndoSpaceRequestSchema>;

/** 一期的简报：信息流顶部、订阅的往期、首页回顾都用它。 */
export const IssueBriefSchema = Type.Object({
  spaceId: IdSchema,
  subscriptionId: IdSchema,
  issueNumber: Type.Integer({ minimum: 1 }),
  edition: Edition,
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
