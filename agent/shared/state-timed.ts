import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const TIMED_SLOT_SOURCES = ['subscription', 'review', 'heartbeat', 'dream'] as const;
export type TimedSlotSource = (typeof TIMED_SLOT_SOURCES)[number];
export const TIMED_SLOT_OUTCOMES = ['done', 'unmet', 'failed', 'stopped', 'quiet', 'skipped'] as const;

const Json = Type.Record(Type.String(), Type.Unknown());

export const TimedSlotInputSchema = Type.Object({
  source: Type.Enum(TIMED_SLOT_SOURCES),
  config: Type.Optional(Json),
}, STRICT);

export const TimedSlotPatchSchema = Type.Partial(Type.Object({
  nextAt: Nullable(IsoTimeSchema),
  lastRunAt: Nullable(IsoTimeSchema),
  lastOutcome: Nullable(Type.Enum(TIMED_SLOT_OUTCOMES)),
  lastNote: Nullable(Type.String({ maxLength: 300 })),
  lineId: Nullable(IdSchema),
  enabled: Type.Boolean(),
  removedAt: Nullable(IsoTimeSchema),
  config: Json,
  memo: Json,
}), STRICT);
export type TimedSlotPatch = Static<typeof TimedSlotPatchSchema>;

export const TimedSlotSchema = Type.Object({
  ...RECORD_META,
  source: Type.Enum(TIMED_SLOT_SOURCES),
  nextAt: Nullable(IsoTimeSchema),
  lastRunAt: Nullable(IsoTimeSchema),
  lastOutcome: Nullable(Type.Enum(TIMED_SLOT_OUTCOMES)),
  lastNote: Nullable(Type.String()),
  lineId: Nullable(IdSchema),
  enabled: Type.Boolean(),
  removedAt: Nullable(IsoTimeSchema),
  config: Json,
  memo: Json,
});
export type TimedSlot = Static<typeof TimedSlotSchema>;

export const HeartbeatFactSchema = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 200 }),
  item: Type.String({ minLength: 1, maxLength: 60 }),
  text: Type.String({ maxLength: 500 }),
}, STRICT);
export type HeartbeatFact = Static<typeof HeartbeatFactSchema>;

export const HEARTBEAT_ACTS = ['notify', 'start', 'suggest'] as const;
export const HeartbeatActSchema = Type.Object({
  kind: Type.Enum(HEARTBEAT_ACTS),
  text: Type.String({ maxLength: 300 }),
  ref: Nullable(Type.String({ maxLength: 200 })),
}, STRICT);
export type HeartbeatAct = Static<typeof HeartbeatActSchema>;

export const HeartbeatBeatInputSchema = Type.Object({
  at: IsoTimeSchema,
  found: Type.Array(HeartbeatFactSchema),
  did: Type.Array(HeartbeatActSchema),
  note: Type.String({ maxLength: 300 }),
  failed: Type.Boolean(),
}, STRICT);
export type HeartbeatBeatInput = Static<typeof HeartbeatBeatInputSchema>;
export const HeartbeatBeatSchema = Type.Object({ ...RECORD_META, ...HeartbeatBeatInputSchema.properties });
export type HeartbeatBeat = Static<typeof HeartbeatBeatSchema>;
