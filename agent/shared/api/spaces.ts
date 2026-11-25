import { Type, type Static } from 'typebox';
import {
  SPACE_EDITIONS,
  SPACE_GENRES,
  SPACE_HTML_MAX_CHARS,
  SPACE_TITLE_MAX_CHARS,
  SPACE_AUTHORS,
  SpaceDocSchema,
  SpaceMetadataSchema,
  SpaceRevisionSchema,
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

export const SPACE_KINDS = ['space', 'research', 'review'] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const SpaceListItemSchema = Type.Object({
  ...Type.Partial(SpaceMetadataSchema).properties,
  id: IdSchema,
  title: Type.String(),
  kind: Type.Enum(SPACE_KINDS),
  genre: Genre,
  author: Type.Enum(SPACE_AUTHORS),
  subscriptionId: OrNull(IdSchema),
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
  edition: Edition,
  version: Type.Integer({ minimum: 1 }),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
}, STRICT);
export type SpaceListItem = Static<typeof SpaceListItemSchema>;
export const SpaceListResponseSchema = Type.Object({ spaces: Type.Array(SpaceListItemSchema) }, STRICT);
export type SpaceListResponse = Static<typeof SpaceListResponseSchema>;
export const SpaceVersionInfoSchema = Type.Omit(SpaceRevisionSchema, ['doc', 'html']);
export const SpaceVersionsResponseSchema = Type.Object({ versions: Type.Array(SpaceVersionInfoSchema),
  selected: OrNull(SpaceRevisionSchema) }, STRICT);
export type SpaceVersionsResponse = Static<typeof SpaceVersionsResponseSchema>;

export const SpaceChangeSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  change: Type.String(),
  rule: OrNull(Type.String()),
  adopted: Type.Boolean(),
}, STRICT);
export type SpaceChange = Static<typeof SpaceChangeSchema>;

export const SpaceViewSchema = Type.Object({
  writerLineId: Type.Optional(OrNull(IdSchema)),
  ...Type.Partial(SpaceMetadataSchema).properties,
  id: IdSchema,
  title: Type.String(),
  version: Type.Integer({ minimum: 1 }),
  kind: Type.Enum(SPACE_KINDS),
  genre: Genre,
  author: Type.Enum(SPACE_AUTHORS),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  html: OrNull(Type.String()),
  doc: SpaceDocSchema,
  subscription: OrNull(Type.Object({ id: IdSchema, title: Type.String(), version: Type.Integer({ minimum: 1 }) },
    STRICT)),
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
  edition: Edition,
  lastChange: OrNull(SpaceChangeSchema),
}, STRICT);
export type SpaceView = Static<typeof SpaceViewSchema>;

export const SaveSpaceRequestSchema = Type.Object({
  ...Type.Partial(SpaceMetadataSchema).properties,
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

export const DeleteSpaceRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 1 }),
}, STRICT);
export type DeleteSpaceRequest = Static<typeof DeleteSpaceRequestSchema>;

export const RestoreSpaceRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type RestoreSpaceRequest = Static<typeof RestoreSpaceRequestSchema>;

export const SPACE_LIST_STANDALONE_PARAM = 'standalone';

export const IssueBriefSchema = Type.Object({
  spaceId: IdSchema,
  subscriptionId: IdSchema,
  issueNumber: Type.Integer({ minimum: 1 }),
  edition: Edition,
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
