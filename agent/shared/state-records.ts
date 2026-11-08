// Conversation records (messages, runs, run_events), telemetry events and the old-id map used by the importer.
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, MIGRATION_META, Nullable, OBJECT_META } from './state-common.ts';
import { DisagreementSchema } from './state-objects.ts';
import { MESSAGE_WIDGETS_MAX, MessageAnswerToSchema, MessageWidgetSchema } from './api/message-widgets.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });
const Payload = Type.Record(Type.String(), Type.Unknown());

/**
 * 一条回复的四层：结论 / 卡 / 理由 / 动作（《实施方案》第 6 节）。10-27 第 80 条：旧回复整段进「理由」，结论为空并标
 * conclusionPending（界面显示「待补」），不把首句装成结论。
 */
export const ReplyLayersSchema = Type.Object(
  {
    conclusion: Nullable(Type.String()),
    conclusionPending: Type.Boolean(),
    cards: Type.Array(Payload),
    reasoning: Type.String(),
    actions: Type.Array(Payload),
  },
  STRICT,
);
export type ReplyLayers = Static<typeof ReplyLayersSchema>;

/** 消息上的分歧标记：同判断里的分歧字段，外加它指向哪条判断（可空）。 */
export const MessageDisagreementSchema = Type.Object(
  { ...DisagreementSchema.properties, judgmentId: Nullable(IdSchema),
    disagreementId: Type.Optional(IdSchema),
    status: Type.Optional(Type.Enum(['open', 'resolved'])),
    proposedChange: Type.Optional(Nullable(Type.String())),
  },
  STRICT,
);

export const AttachmentRefSchema = Type.Object({ ref: IdSchema, name: Nullable(Type.String()) }, STRICT);

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export const MessageInputSchema = Type.Object(
  {
    chatId: Text,
    role: Type.Enum(MESSAGE_ROLES),
    content: Type.String(),
    sentAt: IsoTimeSchema,
    // Client-generated; a resent message with the same request_id returns the stored one (《实施方案》第 5 节).
    requestId: Type.Optional(Nullable(IdSchema)),
    runId: Type.Optional(Nullable(IdSchema)),
    replyLayers: Type.Optional(Nullable(ReplyLayersSchema)),
    disagreement: Type.Optional(Nullable(MessageDisagreementSchema)),
    attachments: Type.Optional(Type.Array(AttachmentRefSchema)),
    // Compaction keeps the original row and marks it inactive (harness 5.6).
    active: Type.Optional(Type.Boolean()),
    // 2026-11-03：回复里的部件（show_widgets 放的）和它们的答案、状态；作答记成的用户消息用 answerTo 指回部件。
    widgets: Type.Optional(Type.Array(MessageWidgetSchema, { maxItems: MESSAGE_WIDGETS_MAX })),
    answerTo: Type.Optional(Nullable(MessageAnswerToSchema)),
  },
  STRICT,
);
export type MessageInput = Static<typeof MessageInputSchema>;
export const MessagePatchSchema = Type.Partial(
  Type.Object({
    replyLayers: Nullable(ReplyLayersSchema),
    disagreement: Nullable(MessageDisagreementSchema),
    active: Type.Boolean(),
    runId: Nullable(IdSchema),
    widgets: Type.Array(MessageWidgetSchema, { maxItems: MESSAGE_WIDGETS_MAX }),
  }),
  STRICT,
);
export type MessagePatch = Static<typeof MessagePatchSchema>;
export const MessageSchema = Type.Object({ ...OBJECT_META, ...Type.Required(MessageInputSchema).properties });
export type StoredMessage = Static<typeof MessageSchema>;

export const RUN_KINDS = ['conversation', 'task'] as const;
export const RUN_OUTCOMES = ['running', 'completed', 'failed', 'interrupted', 'yielded'] as const;
export const RunInputSchema = Type.Object(
  {
    kind: Type.Enum(RUN_KINDS),
    startedAt: IsoTimeSchema,
    chatId: Type.Optional(Nullable(Type.String())),
    taskId: Type.Optional(Nullable(IdSchema)),
    requestId: Type.Optional(Nullable(IdSchema)),
    model: Type.Optional(Nullable(Type.String())),
    outcome: Type.Optional(Type.Enum(RUN_OUTCOMES)),
    endedAt: Type.Optional(Nullable(IsoTimeSchema)),
    summary: Type.Optional(Nullable(Type.String())),
  },
  STRICT,
);
export type RunInput = Static<typeof RunInputSchema>;
export const RunPatchSchema = Type.Partial(
  Type.Object(Type.Pick(RunInputSchema, ['model', 'outcome', 'endedAt', 'summary']).properties),
  STRICT,
);
export type RunPatch = Static<typeof RunPatchSchema>;
export const RunSchema = Type.Object({ ...OBJECT_META, ...Type.Required(RunInputSchema).properties });
export type Run = Static<typeof RunSchema>;

/** Append-only, numbered per run from 1. `kind` is free text checked here, not in SQL, so new kinds need no rebuild. */
export const RunEventInputSchema = Type.Object({ runId: IdSchema, kind: Text, payload: Payload }, STRICT);
export type RunEventInput = Static<typeof RunEventInputSchema>;
export const RunEventSchema = Type.Object({
  id: IdSchema,
  ...RunEventInputSchema.properties,
  seq: Type.Integer({ minimum: 1 }),
  createdAt: IsoTimeSchema,
  ...MIGRATION_META,
});
export type RunEvent = Static<typeof RunEventSchema>;

// 10-26 第 63 条：遥测并进新库。
export const TelemetryInputSchema = Type.Object(
  { name: Text, occurredAt: IsoTimeSchema, payload: Payload, deviceId: Type.Optional(Nullable(IdSchema)) },
  STRICT,
);
export type TelemetryInput = Static<typeof TelemetryInputSchema>;
export const TelemetryEventSchema = Type.Object({
  id: IdSchema,
  ...Type.Required(TelemetryInputSchema).properties,
  createdAt: IsoTimeSchema,
  ...MIGRATION_META,
});
export type TelemetryEvent = Static<typeof TelemetryEventSchema>;

/** One old row → one new row. The key (库, 表, 旧 id) is unique, which is what makes a re-run import idempotent. */
export const LegacyIdSchema = Type.Object(
  {
    sourceDb: Text,
    sourceTable: Text,
    legacyId: Text,
    targetTable: Text,
    targetId: IdSchema,
  },
  STRICT,
);
export type LegacyId = Static<typeof LegacyIdSchema>;
