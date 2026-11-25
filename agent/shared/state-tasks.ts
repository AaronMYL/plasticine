import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const SCHEDULE_TITLE_MAX_CHARS = 60;
export const SCHEDULE_GOAL_MAX_CHARS = 4_000;
export const SCHEDULE_LABEL_MAX_CHARS = 80;
export const SCHEDULE_RECIPIENTS_MAX = 30;
export const SCHEDULE_RECIPIENT_MAX_CHARS = 40;
export const SCHEDULE_FIXED_TEXT_MAX_CHARS = 200;
export const SCHEDULE_FIXED_TEXTS_MAX = 10;
export const SCHEDULE_INTERVAL_MIN_MINUTES = 15;
export const SCHEDULE_INTERVAL_MAX_MINUTES = 24 * 60;

export const ClockSchema = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });

export const ScheduleCadenceSchema = Type.Union([
  Type.Object({ type: Type.Literal('daily'), at: ClockSchema }, STRICT),
  Type.Object({
    type: Type.Literal('weekly'),
    days: Type.Array(Type.Integer({ minimum: 1, maximum: 7 }), { minItems: 1, maxItems: 7, uniqueItems: true }),
    at: ClockSchema,
  }, STRICT),
  Type.Object({
    type: Type.Literal('interval'),
    minutes: Type.Integer({ minimum: SCHEDULE_INTERVAL_MIN_MINUTES, maximum: SCHEDULE_INTERVAL_MAX_MINUTES }),
  }, STRICT),
]);
export type ScheduleCadence = Static<typeof ScheduleCadenceSchema>;

export const ScheduleContentRuleSchema = Type.Union([
  Type.Object({ kind: Type.Literal('emoji') }, STRICT),
  Type.Object({
    kind: Type.Literal('fixed'),
    texts: Type.Array(Type.String({ minLength: 1, maxLength: SCHEDULE_FIXED_TEXT_MAX_CHARS }),
      { minItems: 1, maxItems: SCHEDULE_FIXED_TEXTS_MAX }),
  }, STRICT),
]);
export type ScheduleContentRule = Static<typeof ScheduleContentRuleSchema>;

export const ScheduleOutwardSchema = Type.Object({
  channel: Type.String({ minLength: 1, maxLength: 30 }),
  site: Type.String({ minLength: 3, maxLength: 100, pattern: '^[a-z0-9.-]+$' }),
  recipients: Type.Array(Type.String({ minLength: 1, maxLength: SCHEDULE_RECIPIENT_MAX_CHARS }),
    { minItems: 1, maxItems: SCHEDULE_RECIPIENTS_MAX, uniqueItems: true }),
  content: ScheduleContentRuleSchema,
  contentLabel: Type.String({ minLength: 1, maxLength: SCHEDULE_LABEL_MAX_CHARS }),
}, STRICT);
export type ScheduleOutward = Static<typeof ScheduleOutwardSchema>;

export const SCHEDULE_REPORTS = ['always', 'failures'] as const;

export const SCHEDULE_STATUSES = ['draft', 'active', 'paused', 'declined', 'replaced', 'removed'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_OUTCOMES = ['done', 'unmet', 'failed', 'stopped'] as const;
export type ScheduleOutcome = (typeof SCHEDULE_OUTCOMES)[number];

export const ScheduleInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SCHEDULE_TITLE_MAX_CHARS }),
  goal: Type.String({ minLength: 1, maxLength: SCHEDULE_GOAL_MAX_CHARS }),
  cadence: ScheduleCadenceSchema,
  projectId: IdSchema,
  report: Type.Enum(SCHEDULE_REPORTS),
  place: Nullable(Type.String({ minLength: 1, maxLength: SCHEDULE_LABEL_MAX_CHARS })),
  outward: Nullable(ScheduleOutwardSchema),
  replacesId: Nullable(IdSchema),
  draftedBy: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
export type ScheduleInput = Static<typeof ScheduleInputSchema>;

export const SchedulePatchSchema = Type.Partial(Type.Object({
  status: Type.Enum(SCHEDULE_STATUSES),
  lineId: Nullable(IdSchema),
  nextAt: Nullable(IsoTimeSchema),
  lastRunAt: Nullable(IsoTimeSchema),
  lastOutcome: Nullable(Type.Enum(SCHEDULE_OUTCOMES)),
  lastNote: Nullable(Type.String({ maxLength: 200 })),
  confirmAskId: Nullable(IdSchema),
  confirmedAt: Nullable(IsoTimeSchema),
  confirmedByDeviceId: Nullable(IdSchema),
  removedAt: Nullable(IsoTimeSchema),
}), STRICT);
export type SchedulePatch = Static<typeof SchedulePatchSchema>;

export const ScheduleSchema = Type.Object({
  ...RECORD_META,
  ...ScheduleInputSchema.properties,
  status: Type.Enum(SCHEDULE_STATUSES),
  lineId: Nullable(IdSchema),
  nextAt: Nullable(IsoTimeSchema),
  lastRunAt: Nullable(IsoTimeSchema),
  lastOutcome: Nullable(Type.Enum(SCHEDULE_OUTCOMES)),
  lastNote: Nullable(Type.String()),
  confirmAskId: Nullable(IdSchema),
  confirmedAt: Nullable(IsoTimeSchema),
  confirmedByDeviceId: Nullable(IdSchema),
  removedAt: Nullable(IsoTimeSchema),
});
export type Schedule = Static<typeof ScheduleSchema>;

export const ScheduleSendInputSchema = Type.Object({
  scheduleId: IdSchema,
  confirmAskId: IdSchema,
  confirmedByDeviceId: IdSchema,
  lineId: IdSchema,
  runAt: Nullable(IsoTimeSchema),
  toolCallId: Type.String({ minLength: 1, maxLength: 200 }),
  recipient: Type.String({ minLength: 1, maxLength: SCHEDULE_RECIPIENT_MAX_CHARS }),
  content: Type.String({ minLength: 1, maxLength: SCHEDULE_FIXED_TEXT_MAX_CHARS }),
  nodeId: IdSchema,
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  pageVersion: Type.String({ minLength: 1, maxLength: 40 }),
  n: Type.Integer({ minimum: 1 }),
  op: Type.Enum(['click', 'enter']),
  pageUrl: Type.String({ maxLength: 4_096 }),
}, STRICT);
export type ScheduleSendInput = Static<typeof ScheduleSendInputSchema>;

export const ScheduleSendSchema = Type.Object({
  ...RECORD_META,
  ...ScheduleSendInputSchema.properties,
});
export type ScheduleSend = Static<typeof ScheduleSendSchema>;

export const SUGGESTION_TITLE_MAX_CHARS = 60;
export const SUGGESTION_WHY_MAX_CHARS = 200;
export const SUGGESTION_SOURCES = ['plasticine', 'review', 'heartbeat', 'dream'] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];
export const SUGGESTION_ICONS = ['file', 'space', 'mail', 'books', 'clock', 'sparkle'] as const;
export type SuggestionIcon = (typeof SUGGESTION_ICONS)[number];
export const SUGGESTION_STATUSES = ['open', 'started', 'todo', 'dismissed'] as const;

export const SuggestionInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SUGGESTION_TITLE_MAX_CHARS }),
  why: Type.String({ minLength: 1, maxLength: SUGGESTION_WHY_MAX_CHARS }),
  goal: Type.String({ minLength: 1, maxLength: SCHEDULE_GOAL_MAX_CHARS }),
  projectId: Nullable(IdSchema),
  source: Type.Enum(SUGGESTION_SOURCES),
  icon: Type.Enum(SUGGESTION_ICONS),
  key: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  sourceRef: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
}, STRICT);
export type SuggestionInput = Static<typeof SuggestionInputSchema>;

export const SuggestionPatchSchema = Type.Partial(Type.Object({
  status: Type.Enum(SUGGESTION_STATUSES),
  lineId: Nullable(IdSchema),
  todoId: Nullable(IdSchema),
  actedAt: Nullable(IsoTimeSchema),
  actedByDeviceId: Nullable(IdSchema),
}), STRICT);
export type SuggestionPatch = Static<typeof SuggestionPatchSchema>;

export const SuggestionSchema = Type.Object({
  ...RECORD_META,
  ...SuggestionInputSchema.properties,
  status: Type.Enum(SUGGESTION_STATUSES),
  lineId: Nullable(IdSchema),
  todoId: Nullable(IdSchema),
  actedAt: Nullable(IsoTimeSchema),
  actedByDeviceId: Nullable(IdSchema),
});
export type Suggestion = Static<typeof SuggestionSchema>;
