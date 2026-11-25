import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { ProjectTagSchema } from './project-tag.ts';
import { BriefItemViewSchema, ReturnBriefViewSchema, TodayNumbersSchema } from './today.ts';

export const HOME_PATH = `${API_PREFIX}/home`;

export const HOME_CARD_KINDS = [
  'decide',
  'reauth',
  'task_failing',
  'task',
  'project',
  'book',
  'note',
  'feed',
  'calendar',
  'money',
  'focus',
  'matter',
  'web',
  'observe',
  'trial',
  'change',
] as const;
export type HomeCardKind = (typeof HOME_CARD_KINDS)[number];

export const HOME_LAYERS = ['pinned', 'now', 'rest'] as const;
export const HOME_DEVICES = ['desktop', 'phone'] as const;

export const HOME_NOW_MAX = 3;

export const HOME_TARGET_KINDS = [
  'ask',
  'task',
  'project',
  'book',
  'note',
  'feed_item',
  'matter',
  'tool',
  'web',
  'settings',
  'observations',
  'brief_item',
] as const;

export const HomeTargetSchema = Type.Object({
  kind: Type.Enum(HOME_TARGET_KINDS),
  ref: Type.String({ minLength: 1 }),
});

export const HomeScoreSchema = Type.Object({
  urgency: Type.Number({ minimum: 0, maximum: 1 }),
  relevance: Type.Number({ minimum: 0, maximum: 1 }),
  freshness: Type.Number({ minimum: 0, maximum: 1 }),
  reaction: Type.Number({ minimum: 0, maximum: 1 }),
  total: Type.Number({ minimum: 0 }),
});

export const HomeObservationSchema = Type.Object({
  id: IdSchema,
  text: Type.String({ minLength: 1 }),
  at: IsoTimeSchema,
  verdict: OrNull(Type.Union([Type.Literal('right'), Type.Literal('wrong')])),
});

export const HomeCardSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(HOME_CARD_KINDS),
  kindLabel: Type.String({ minLength: 1 }),
  layer: Type.Enum(HOME_LAYERS),
  title: Type.String({ minLength: 1 }),
  detail: OrNull(Type.String()),
  reason: OrNull(Type.String()),
  why: Type.String({ minLength: 1 }),
  score: HomeScoreSchema,
  project: OrNull(ProjectTagSchema),
  target: HomeTargetSchema,
  actionLabel: Type.String({ minLength: 1 }),
  meta: OrNull(Type.String()),
  progress: OrNull(Type.Number({ minimum: 0, maximum: 1 })),
  avatar: Type.Optional(OrNull(Type.String({ minLength: 1, maxLength: 2 }))),
  observations: Type.Array(HomeObservationSchema),
  updatedAt: IsoTimeSchema,
});
export type HomeCard = Static<typeof HomeCardSchema>;

export const HomeQuerySchema = Type.Object(
  { tz: Type.Optional(TimeZoneSchema), device: Type.Optional(Type.Enum(HOME_DEVICES)) },
  { additionalProperties: false },
);

export const HomeResponseSchema = Type.Object({
  date: Type.String(),
  timeZone: Type.String(),
  device: Type.Enum(HOME_DEVICES),
  generatedAt: IsoTimeSchema,
  pinned: Type.Array(HomeCardSchema),
  now: Type.Array(HomeCardSchema, { maxItems: HOME_NOW_MAX }),
  rest: Type.Array(HomeCardSchema),
  pinnedMore: Type.Integer({ minimum: 0 }),
  quieter: Type.Array(Type.Object({ kind: Type.Enum(HOME_CARD_KINDS), times: Type.Integer({ minimum: 1 }) })),
  returnBrief: OrNull(ReturnBriefViewSchema),
  numbers: TodayNumbersSchema,
  changes: Type.Array(BriefItemViewSchema),
});
export type HomeResponse = Static<typeof HomeResponseSchema>;

