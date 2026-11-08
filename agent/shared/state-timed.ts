// 「定时」里不归定时卡管的那几行（订阅、回顾、心跳、做梦，《优化清单》第 3、7、10、11 条）：每一行的下次、上次、
// 它的线、删没删，和它自己的设置（心跳的清单）、记性（心跳上次看到了哪些事）。一行一条 timed_slots。
// 心跳每跳一次叫了模型的那一次记一条 heartbeat_beats（设计稿 Tasks-Heartbeat「最近」）；没变化的不记。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const TIMED_SLOT_SOURCES = ['subscription', 'review', 'heartbeat', 'dream'] as const;
export type TimedSlotSource = (typeof TIMED_SLOT_SOURCES)[number];
/** 上次：做成；没做成（线自己说的）；出错；叫停；看过没事（心跳）；跳过（没有新对话、上一次还没做完）。 */
export const TIMED_SLOT_OUTCOMES = ['done', 'unmet', 'failed', 'stopped', 'quiet', 'skipped'] as const;
export type TimedSlotOutcome = (typeof TIMED_SLOT_OUTCOMES)[number];

const Json = Type.Record(Type.String(), Type.Unknown());

export const TimedSlotInputSchema = Type.Object({
  source: Type.Enum(TIMED_SLOT_SOURCES),
  /** 各来源自己的设置（心跳：多久一次、安静时段、清单；做梦：几点）。由那个模块自己校验。 */
  config: Type.Optional(Json),
}, STRICT);
export type TimedSlotInput = Static<typeof TimedSlotInputSchema>;

export const TimedSlotPatchSchema = Type.Partial(Type.Object({
  nextAt: Nullable(IsoTimeSchema),
  lastRunAt: Nullable(IsoTimeSchema),
  lastOutcome: Nullable(Type.Enum(TIMED_SLOT_OUTCOMES)),
  lastNote: Nullable(Type.String({ maxLength: 300 })),
  lineId: Nullable(IdSchema),
  /** 关掉：心跳、做梦只能关不能删。 */
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
  /** 这一行自己记的东西（算下次用的钟点和时区、心跳上次看到的那些事）。 */
  memo: Json,
});
export type TimedSlot = Static<typeof TimedSlotSchema>;

/** 心跳这一跳看到的一件事（代码筛出来的）。 */
export const HeartbeatFactSchema = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 200 }),
  item: Type.String({ minLength: 1, maxLength: 60 }),
  text: Type.String({ maxLength: 500 }),
}, STRICT);
export type HeartbeatFact = Static<typeof HeartbeatFactSchema>;

export const HEARTBEAT_ACTS = ['notify', 'start', 'suggest'] as const;
export type HeartbeatActKind = (typeof HEARTBEAT_ACTS)[number];
export const HeartbeatActSchema = Type.Object({
  kind: Type.Enum(HEARTBEAT_ACTS),
  text: Type.String({ maxLength: 300 }),
  /** 开的线、提的建议。 */
  ref: Nullable(Type.String({ maxLength: 200 })),
}, STRICT);
export type HeartbeatAct = Static<typeof HeartbeatActSchema>;

export const HeartbeatBeatInputSchema = Type.Object({
  at: IsoTimeSchema,
  found: Type.Array(HeartbeatFactSchema),
  did: Type.Array(HeartbeatActSchema),
  /** 一句：「「评审会」邀请要回复 → 发了消息给你」「没事」「这次没判断成：……」。 */
  note: Type.String({ maxLength: 300 }),
  failed: Type.Boolean(),
}, STRICT);
export type HeartbeatBeatInput = Static<typeof HeartbeatBeatInputSchema>;
export const HeartbeatBeatSchema = Type.Object({ ...RECORD_META, ...HeartbeatBeatInputSchema.properties });
export type HeartbeatBeat = Static<typeof HeartbeatBeatSchema>;
