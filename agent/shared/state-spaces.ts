import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const SPACE_TITLE_MAX_CHARS = 120;
export const SPACE_TEXT_MAX_CHARS = 40_000;
export const SPACE_BLOCKS_MAX = 400;
export const SPACE_STATS_MAX = 4;
export const SPACE_CHART_POINTS_MAX = 120;
export const SPACE_HTML_MAX_CHARS = 500_000;
export const SPACE_AUTHORS = ['user', 'ai'] as const;
export type SpaceAuthor = (typeof SPACE_AUTHORS)[number];

export const SPACE_LINK_KINDS = ['message', 'line', 'project', 'memory_doc', 'note', 'space', 'feed_item'] as const;
export const SpaceLinkSchema = Type.Object({ kind: Type.Enum(SPACE_LINK_KINDS), id: IdSchema }, STRICT);
export type SpaceLink = Static<typeof SpaceLinkSchema>;

export const SpaceSourceSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 300 }),
  url: Type.Optional(Type.String({ minLength: 1, maxLength: 2000, pattern: '^https?://' })),
  link: Type.Optional(SpaceLinkSchema),
}, STRICT);
export type SpaceSource = Static<typeof SpaceSourceSchema>;

const Text = Type.String({ minLength: 1, maxLength: SPACE_TEXT_MAX_CHARS });

export const SpaceHeadingSchema = Type.Object({
  type: Type.Literal('heading'),
  id: Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9_-]+$' }),
  text: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);

export const SpaceTextSchema = Type.Object({ type: Type.Literal('text'), markdown: Text }, STRICT);

export const SPACE_CHART_KINDS = ['line', 'bar'] as const;
export const SpaceChartSchema = Type.Object({
  type: Type.Literal('chart'),
  kind: Type.Enum(SPACE_CHART_KINDS),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  x: Type.Array(Type.Union([Type.String({ maxLength: 40 }), Type.Number()]),
    { minItems: 1, maxItems: SPACE_CHART_POINTS_MAX }),
  series: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 60 }),
    values: Type.Array(Type.Number(), { minItems: 1, maxItems: SPACE_CHART_POINTS_MAX }),
  }, STRICT), { minItems: 1, maxItems: 4 }),
  unit: Type.Optional(Type.String({ maxLength: 12 })),
  caption: Type.String({ minLength: 1, maxLength: 300 }),
  source: SpaceSourceSchema,
  basis: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
}, STRICT);
export type SpaceChart = Static<typeof SpaceChartSchema>;

export const SpaceImageSchema = Type.Object({
  type: Type.Literal('image'),
  url: Type.String({ minLength: 1, maxLength: 2000, pattern: '^(https?://|/)' }),
  alt: Type.String({ minLength: 1, maxLength: 300 }),
  caption: Type.Optional(Type.String({ maxLength: 300 })),
  source: SpaceSourceSchema,
}, STRICT);

export const SpaceQuoteSchema = Type.Object({
  type: Type.Literal('quote'),
  text: Type.String({ minLength: 1, maxLength: 4000 }),
  source: SpaceSourceSchema,
}, STRICT);

export const SpaceBlockSchema = Type.Union([SpaceHeadingSchema, SpaceTextSchema, SpaceChartSchema, SpaceImageSchema,
  SpaceQuoteSchema]);
export type SpaceBlock = Static<typeof SpaceBlockSchema>;

export const SpaceStatSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 16 }),
  label: Type.String({ minLength: 1, maxLength: 40 }),
}, STRICT);

export const SpaceDocSchema = Type.Object({
  kicker: Type.Optional(Type.String({ maxLength: 80 })),
  headline: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  stats: Type.Array(SpaceStatSchema, { maxItems: SPACE_STATS_MAX }),
  blocks: Type.Array(SpaceBlockSchema, { maxItems: SPACE_BLOCKS_MAX }),
  sources: Type.Array(SpaceSourceSchema, { maxItems: 200 }),
}, STRICT);
export type SpaceDoc = Static<typeof SpaceDocSchema>;

export const SPACE_GENRES = ['report', 'letter'] as const;
export type SpaceGenre = (typeof SPACE_GENRES)[number];
const Html = Type.String({ minLength: 1, maxLength: SPACE_HTML_MAX_CHARS });

export const EMPTY_SPACE_DOC: SpaceDoc = { stats: [], blocks: [], sources: [] };

export const SPACE_EDITIONS = ['daily', 'weekly'] as const;
export type SpaceEdition = (typeof SPACE_EDITIONS)[number];

export const SPACE_CATEGORIES = ['report', 'letter', 'webarchive', 'booknote'] as const;
export const SpaceMetadataSchema = Type.Object({
  category: Type.Enum(SPACE_CATEGORIES),
  sourceUrl: Nullable(Type.String({ minLength: 1, maxLength: 2000, pattern: '^(https?://|#/|book:)' })),
  bookId: Nullable(IdSchema),
  folder: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
}, STRICT);
export type SpaceMetadata = Static<typeof SpaceMetadataSchema>;

export const SpaceInputSchema = Type.Object({
  ...Type.Partial(SpaceMetadataSchema).properties,
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  doc: SpaceDocSchema,
  genre: Type.Optional(Nullable(Type.Enum(SPACE_GENRES))),
  html: Type.Optional(Nullable(Html)),
  author: Type.Enum(SPACE_AUTHORS),
  subscriptionId: Type.Optional(Nullable(IdSchema)),
  issueNumber: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
  edition: Type.Optional(Nullable(Type.Enum(SPACE_EDITIONS))),
  sourceNoteId: Type.Optional(Nullable(IdSchema)),
}, STRICT);
export type SpaceInput = Static<typeof SpaceInputSchema>;

export const SpaceSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(SpaceInputSchema).properties,
  deletedAt: Nullable(IsoTimeSchema),
}, STRICT);
export type Space = Static<typeof SpaceSchema>;

export const SpaceRevisionSchema = Type.Object({
  spaceId: IdSchema,
  lineId: Type.Optional(Nullable(IdSchema)),
  version: Type.Integer({ minimum: 1 }),
  doc: SpaceDocSchema,
  genre: Nullable(Type.Enum(SPACE_GENRES)),
  html: Nullable(Html),
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  author: Type.Enum(SPACE_AUTHORS),
  savedAt: IsoTimeSchema,
  change: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  rule: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  restoredFrom: Nullable(Type.Integer({ minimum: 1 })),
}, STRICT);
export type SpaceRevision = Static<typeof SpaceRevisionSchema>;

export const SUBSCRIPTION_KINDS = ['research', 'review'] as const;
export const SUBSCRIPTION_STATUSES = ['draft', 'sample', 'active', 'paused'] as const;

const Clock = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });
const Weekday = Type.Integer({ minimum: 0, maximum: 6 });

export const SubscriptionScheduleSchema = Type.Object({
  every: Type.Enum(['day', 'week']),
  weekday: Type.Optional(Weekday),
  time: Clock,
}, STRICT);
export type SubscriptionSchedule = Static<typeof SubscriptionScheduleSchema>;

export const SubscriptionRuleSchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 200 }),
  fromIssue: Nullable(Type.Integer({ minimum: 1 })),
  addedAt: IsoTimeSchema,
}, STRICT);
export type SubscriptionRule = Static<typeof SubscriptionRuleSchema>;

const Labels = (max: number) => Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: max });

export const ResearchSettingsSchema = Type.Object({
  kind: Type.Literal('research'),
  topics: Labels(20),
  focus: Nullable(Type.Enum(['basic', 'clinical'])),
  depth: Nullable(Type.Enum(['expert', 'popular'])),
  sources: Labels(20),
  preprints: Type.Enum(['skip', 'mark', 'include']),
  filter: Type.String({ maxLength: 500 }),
  schedule: SubscriptionScheduleSchema,
  sections: Labels(10),
  output: Type.String({ maxLength: 500 }),
  rules: Type.Array(SubscriptionRuleSchema, { maxItems: 50 }),
}, STRICT);
export type ResearchSettings = Static<typeof ResearchSettingsSchema>;

export const ReviewExcludeSchema = Type.Object({
  kind: Type.Enum(['line', 'project', 'memory_doc', 'feed_source']),
  id: IdSchema,
  label: Type.String({ minLength: 1, maxLength: 120 }),
}, STRICT);

export const ReviewSettingsSchema = Type.Object({
  kind: Type.Literal('review'),
  daily: Type.Object({ on: Type.Boolean(), time: Clock }, STRICT),
  weekly: Type.Object({ on: Type.Boolean(), weekday: Weekday, time: Clock }, STRICT),
  topics: Labels(20),
  sources: Labels(20),
  exclude: Type.Array(ReviewExcludeSchema, { maxItems: 200 }),
  rules: Type.Array(SubscriptionRuleSchema, { maxItems: 50 }),
}, STRICT);
export type ReviewSettings = Static<typeof ReviewSettingsSchema>;

export const SubscriptionSettingsSchema = Type.Union([ResearchSettingsSchema, ReviewSettingsSchema]);
export type SubscriptionSettings = Static<typeof SubscriptionSettingsSchema>;

export const SubscriptionInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  kind: Type.Enum(SUBSCRIPTION_KINDS),
  status: Type.Enum(SUBSCRIPTION_STATUSES),
  settings: SubscriptionSettingsSchema,
  timeZone: Type.String({ minLength: 1, maxLength: 64 }),
}, STRICT);
export type SubscriptionInput = Static<typeof SubscriptionInputSchema>;

export const SubscriptionPatchSchema = Type.Partial(Type.Object({
  title: Type.String({ minLength: 1, maxLength: SPACE_TITLE_MAX_CHARS }),
  status: Type.Enum(SUBSCRIPTION_STATUSES),
  settings: SubscriptionSettingsSchema,
  timeZone: Type.String({ minLength: 1, maxLength: 64 }),
  lineId: Nullable(IdSchema),
  lastRunAt: Nullable(IsoTimeSchema),
}), STRICT);
export type SubscriptionPatch = Static<typeof SubscriptionPatchSchema>;

export const SubscriptionSchema = Type.Object({
  ...RECORD_META,
  ...SubscriptionInputSchema.properties,
  lineId: Nullable(IdSchema),
  lastRunAt: Nullable(IsoTimeSchema),
}, STRICT);
export type Subscription = Static<typeof SubscriptionSchema>;
