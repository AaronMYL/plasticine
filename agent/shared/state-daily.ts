import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';
import { PreferredTimeZoneSchema } from './time-zone.ts';
import { FeedBannedTermsSchema } from './feed-search.ts';

const STRICT = { additionalProperties: false };

export const DaySchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

export const REGISTRATION_KINDS = ['signup', 'withdrawal'] as const;

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

export const FEED_ORIGINS = ['feed', 'task', 'concern', 'manual'] as const;
export const FEED_LIST_ORIGINS = ['feed', 'manual'] as const satisfies readonly (typeof FEED_ORIGINS)[number][];
export const FEED_REACTIONS = ['like', 'dislike'] as const;
export const FEED_ITEM_KINDS = ['x', 'rss', 'news', 'manual', 'douyin', 'reddit', 'xhs'] as const;
export const FEED_FILTER_KINDS = ['x', 'rss', 'news', 'douyin', 'reddit', 'xhs'] as const satisfies
  readonly (typeof FEED_ITEM_KINDS)[number][];
export const FEED_PLACES = ['following', 'recommend', 'bookmark', 'saved'] as const;
export type FeedPlace = (typeof FEED_PLACES)[number];
export const FEED_PLACE_LABELS: Readonly<Record<FeedPlace, string>> = {
  following: '关注', recommend: '推荐', bookmark: '书签', saved: '收藏',
};
export const FEED_BLOCK_TYPES = ['p', 'h', 'quote', 'li', 'code', 'img'] as const;
export const FeedBlockSchema = Type.Object({
  t: Type.Enum(FEED_BLOCK_TYPES),
  text: Type.String({ maxLength: 20_000 }),
  src: Type.Optional(Type.String({ pattern: '^https://', maxLength: 3_000 })),
}, { additionalProperties: false });
export type FeedBlock = Static<typeof FeedBlockSchema>;
export const FEED_BODY_MAX_BLOCKS = 400;
export const FEED_TEXT_MAX_CHARS = 100_000;
export const FEED_URL_MAX_CHARS = 3_000;
export const FEED_IMAGE_RATIO_MIN = 0.2;
export const FEED_IMAGE_RATIO_MAX = 5;
const FeedImageLinkSchema = Type.String({ pattern: '^https://', maxLength: FEED_URL_MAX_CHARS });
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
    ref: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 300 }))),
    dedupeKey: Type.String({ minLength: 1, maxLength: 300 }),
    day: DaySchema,
    publishedAt: Type.Optional(Nullable(IsoTimeSchema)),
    arrivedAt: IsoTimeSchema,
    author: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 200 }))),
    authorHandle: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 100 }))),
    avatarUrl: Type.Optional(Nullable(FeedImageLinkSchema)),
    imageUrl: Type.Optional(Nullable(FeedImageLinkSchema)),
    imageRatio: Type.Optional(Nullable(Type.Number({ minimum: FEED_IMAGE_RATIO_MIN, maximum: FEED_IMAGE_RATIO_MAX }))),
    moreImages: Type.Optional(Type.Array(FeedImageSchema, { maxItems: FEED_MORE_IMAGES_MAX })),
    places: Type.Optional(Type.Array(Type.Enum(FEED_PLACES), { maxItems: FEED_PLACES.length })),
    body: Type.Optional(Nullable(Type.Array(FeedBlockSchema, { maxItems: FEED_BODY_MAX_BLOCKS }))),
  },
  STRICT,
);
export type FeedItemInput = Static<typeof FeedItemInputSchema>;
export const FeedItemPatchSchema = Type.Partial(
  Type.Object({
    sourceId: IdSchema,
    topic: Nullable(Type.String({ maxLength: 200 })),
    reaction: Nullable(Type.Enum(FEED_REACTIONS)),
    savedAt: Nullable(IsoTimeSchema),
    note: Nullable(Type.String({ maxLength: 10_000 })),
    seenAt: Nullable(IsoTimeSchema),
    concernId: Nullable(IdSchema),
    places: Type.Array(Type.Enum(FEED_PLACES), { maxItems: FEED_PLACES.length }),
    body: Nullable(Type.Array(FeedBlockSchema, { maxItems: FEED_BODY_MAX_BLOCKS })),
    url: Nullable(Type.String({ pattern: '^https?://', maxLength: FEED_URL_MAX_CHARS })),
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

export const BRIEF_CATEGORIES = ['decision', 'goal_change', 'noteworthy', 'alignment'] as const;
export const BRIEF_REF_TYPES = ['ask', 'task', 'concern', 'judgment', 'agreement', 'registration'] as const;

export const RETURN_SENTENCE_KEYS = ['kept', 'changed', 'progressed', 'connections'] as const;
export const RETURN_TARGET_VIEWS = ['concerns', 'judgments', 'tasks', 'feed'] as const;
export const RETURN_BRIEF_STATUSES = ['composing', 'ready'] as const;

/** The last time the user did something in the app (any device). */
export const PresenceSchema = Type.Object(
  { lastActiveAt: IsoTimeSchema, deviceId: Nullable(IdSchema), updatedAt: IsoTimeSchema },
  STRICT,
);
export type Presence = Static<typeof PresenceSchema>;

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
