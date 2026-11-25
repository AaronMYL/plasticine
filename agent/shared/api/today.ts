import { Type, type Static } from 'typebox';
import { FeedBannedTermsSchema } from '../feed-search.ts';
import { PreferredTimeZoneSchema } from '../time-zone.ts';
import {
  BRIEF_CATEGORIES, BRIEF_LIMIT_MAX, BRIEF_REF_TYPES, RETURN_BRIEF_STATUSES, RETURN_SENTENCE_KEYS, RETURN_TARGET_VIEWS,
  RETURN_THRESHOLD_HOURS_MAX, INTERVIEW_PER_DAY_MAX,
} from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const TODAY_PATH = `${API_PREFIX}/today`;
export const TODAY_SETTINGS_PATH = `${TODAY_PATH}/settings`;

export const ReturnSentenceViewSchema = Type.Object({
  key: Type.Enum(RETURN_SENTENCE_KEYS),
  label: Type.String(),
  text: Type.String(),
  target: Type.Object({ view: Type.Enum(RETURN_TARGET_VIEWS), ids: Type.Array(IdSchema) }),
  quiet: Type.Optional(Type.Boolean()),
});
export type ReturnSentenceView = Static<typeof ReturnSentenceViewSchema>;

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

export const TodayNumbersSchema = Type.Object({
  feedNew: Type.Integer({ minimum: 0 }),
  concernsActive: Type.Integer({ minimum: 0 }),
  concernsPendingClose: Type.Integer({ minimum: 0 }),
  projectsActive: Type.Integer({ minimum: 0 }),
  moneyThisMonth: OrNull(Type.Integer()),
  calendarToday: OrNull(Type.Integer({ minimum: 0 })),
  focusMinutesToday: OrNull(Type.Integer({ minimum: 0 })),
});
export type TodayNumbers = Static<typeof TodayNumbersSchema>;

export const ReadReturnBriefRequestSchema = Type.Object(
  { requestId: RequestIdSchema, connected: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type ReadReturnBriefRequest = Static<typeof ReadReturnBriefRequestSchema>;

export const SeeBriefItemRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type SeeBriefItemRequest = Static<typeof SeeBriefItemRequestSchema>;

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
