// /v2/today/*：首页（/v2/home，第 102 条）用到的回来四句话、十件事和每日设置的写接口与视图。原来的
// GET /v2/today（今日三块）2026-11-03 随「旧版今日」一起删掉：首页一次给全，十件事在首页是「变化」卡。
// 回来四句话：点「接上了 / 没接上」（0 / 1，一周最多问一次）或「收起」都算读过，头部收成一行；四句话在下次离开前不变。

import { Type, type Static } from 'typebox';
import { FeedBannedTermsSchema } from '../feed-search.ts';
import { PreferredTimeZoneSchema } from '../time-zone.ts';
import {
  BRIEF_CATEGORIES,
  BRIEF_LIMIT_MAX,
  BRIEF_REF_TYPES,
  RETURN_BRIEF_STATUSES,
  RETURN_SENTENCE_KEYS,
  RETURN_TARGET_VIEWS,
  RETURN_THRESHOLD_HOURS_MAX,
  INTERVIEW_PER_DAY_MAX,
  type ReturnSentence,
} from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const TODAY_PATH = `${API_PREFIX}/today`;
export const RETURN_BRIEFS_PATH = `${TODAY_PATH}/return-briefs`;
export const BRIEF_ITEMS_PATH = `${TODAY_PATH}/brief-items`;
export const TODAY_SETTINGS_PATH = `${TODAY_PATH}/settings`;

/** 四句的左侧小标签（views.md）：保留 · 变化 · 推进 · 新联系。 */
export const RETURN_SENTENCE_LABELS: Readonly<Record<ReturnSentence['key'], string>> = {
  kept: '保留',
  changed: '变化',
  progressed: '推进',
  connections: '新联系',
};

export const ReturnSentenceViewSchema = Type.Object({
  key: Type.Enum(RETURN_SENTENCE_KEYS),
  label: Type.String(),
  text: Type.String(),
  /** 去向：点开到哪一页、哪几条。 */
  /** 真实目标 ID，按正文提及顺序；首个为主要去向，无相关记录时为空。 */
  target: Type.Object({ view: Type.Enum(RETURN_TARGET_VIEWS), ids: Type.Array(IdSchema) }),
  /** 这一句只是说「这段时间没有…」：界面不摆（第 109 条）。 */
  quiet: Type.Optional(Type.Boolean()),
});
export type ReturnSentenceView = Static<typeof ReturnSentenceViewSchema>;

/**
 * `sentences` is empty while `composing` (the brain is still writing them; `return_brief_ready` follows). `readAt`
 * set = folded into one line. `asksConnected`: this return shows 「接上了吗」 (at most once a week).
 */
export const ReturnBriefViewSchema = Type.Object({
  id: IdSchema,
  awaySince: IsoTimeSchema,
  returnedAt: IsoTimeSchema,
  awayMs: Type.Integer({ minimum: 0 }),
  status: Type.Enum(RETURN_BRIEF_STATUSES),
  composedBy: OrNull(Type.Enum(['brain', 'data'])),
  sentences: Type.Array(ReturnSentenceViewSchema),
  asksConnected: Type.Boolean(),
  readAt: OrNull(IsoTimeSchema),
  connected: OrNull(Type.Boolean()),
  version: Type.Integer({ minimum: 1 }),
});
export type ReturnBriefView = Static<typeof ReturnBriefViewSchema>;

/** 十件事的一行：权重（来源的 w，只是显示）· 变化 · 来源 · 看过 · 状态（新 / 差异待核对）。 */
export const BriefItemViewSchema = Type.Object({
  id: IdSchema,
  day: Type.String(),
  category: Type.Enum(BRIEF_CATEGORIES),
  weight: Type.Number(),
  title: Type.String(),
  body: Type.String(),
  sourceLabel: Type.String(),
  refType: Type.Enum(BRIEF_REF_TYPES),
  refId: IdSchema,
  isNew: Type.Boolean(),
  diffPending: Type.Boolean(),
  disagreementId: Type.Optional(OrNull(IdSchema)),
  seenAt: OrNull(IsoTimeSchema),
  version: Type.Integer({ minimum: 1 }),
});
export type BriefItemView = Static<typeof BriefItemViewSchema>;

export const BriefItemEvidenceSchema = Type.Object({
  body: Type.String(), sourceLabel: Type.String(), sourceRef: Type.String(),
  contentAt: Type.Enum(['change', 'current']),
  version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  disagreementId: OrNull(IdSchema),
  changes: Type.Array(Type.Object({ actor: Type.String(), reason: Type.String(), at: IsoTimeSchema })),
  evidence: Type.Array(Type.Object({ id: IdSchema, content: Type.String(), identity: Type.String(),
    sourceLabel: Type.String(), sourceRef: OrNull(Type.String()), scope: Type.String() })),
  registration: OrNull(Type.Object({ concernId: IdSchema, kind: Type.Enum(['signup', 'withdrawal']),
    signups: Type.Integer(), withdrawals: Type.Integer(), count: Type.Integer(), at: IsoTimeSchema })),
});
export type BriefItemEvidence = Static<typeof BriefItemEvidenceSchema>;

/** 今天的数. null = not available yet (记账、日程、专注 come with M5). */
export const TodayNumbersSchema = Type.Object({
  feedNew: Type.Integer({ minimum: 0 }),
  concernsActive: Type.Integer({ minimum: 0 }),
  concernsPendingClose: Type.Integer({ minimum: 0 }),
  /** 在进行的项目（第 101 条：今天的数里「关切」换成「项目」）。 */
  projectsActive: Type.Integer({ minimum: 0 }),
  moneyThisMonth: OrNull(Type.Integer()),
  calendarToday: OrNull(Type.Integer({ minimum: 0 })),
  focusMinutesToday: OrNull(Type.Integer({ minimum: 0 })),
});
export type TodayNumbers = Static<typeof TodayNumbersSchema>;

/**
 * POST /v2/today/return-briefs/:id/read → 200 { brief }. With 「接上了吗」 shown, `connected` is required (true = 接上了 /
 * 1); without it, `connected` must be left out (a week's one answer is not filled in for you). A brief read on another
 * device is 409 with the current brief; one still composing is 409 `not_ready`.
 */
export const ReadReturnBriefRequestSchema = Type.Object(
  { requestId: RequestIdSchema, connected: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type ReadReturnBriefRequest = Static<typeof ReadReturnBriefRequestSchema>;
export const ReturnBriefResponseSchema = Type.Object({ brief: ReturnBriefViewSchema });
export type ReturnBriefResponse = Static<typeof ReturnBriefResponseSchema>;

/** POST /v2/today/brief-items/:id/seen → 200 { item }: 看过（计数）。 */
export const SeeBriefItemRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type SeeBriefItemRequest = Static<typeof SeeBriefItemRequestSchema>;
export const BriefItemResponseSchema = Type.Object({ item: BriefItemViewSchema });
export type BriefItemResponse = Static<typeof BriefItemResponseSchema>;

export const DailySettingsViewSchema = Type.Object({
  feedBannedTerms: FeedBannedTermsSchema,
  timeZone: PreferredTimeZoneSchema,
  briefLimit: Type.Integer({ minimum: 1, maximum: BRIEF_LIMIT_MAX }),
  returnThresholdHours: Type.Number(),
  interviewEnabled: Type.Boolean(),
  collisionEnabled: Type.Optional(Type.Boolean()),
  cognitionReviewEnabled: Type.Optional(Type.Boolean()),
  interviewPerDay: Type.Integer({ minimum: 1 }),
  /** 0 until saved once. */
  version: Type.Integer({ minimum: 0 }),
});
export type DailySettingsView = Static<typeof DailySettingsViewSchema>;

/** PUT /v2/today/settings → 200 settings: 十件事上限、离开多久算「回来」、采访开关和每天几题。 */
export const UpdateDailySettingsRequestSchema = Type.Object(
  {
    feedBannedTerms: FeedBannedTermsSchema,
    timeZone: PreferredTimeZoneSchema,
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 0 }),
    briefLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: BRIEF_LIMIT_MAX })),
    returnThresholdHours: Type.Optional(Type.Number({ minimum: 0.25, maximum: RETURN_THRESHOLD_HOURS_MAX })),
    interviewEnabled: Type.Optional(Type.Boolean()),
    collisionEnabled: Type.Optional(Type.Boolean()),
    cognitionReviewEnabled: Type.Optional(Type.Boolean()),
    interviewPerDay: Type.Optional(Type.Integer({ minimum: 1, maximum: INTERVIEW_PER_DAY_MAX })),
  },
  { additionalProperties: false },
);
export type UpdateDailySettingsRequest = Static<typeof UpdateDailySettingsRequestSchema>;
