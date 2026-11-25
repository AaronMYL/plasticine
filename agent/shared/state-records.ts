import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';
import { DisagreementSchema } from './state-objects.ts';
import { MESSAGE_WIDGETS_MAX, MessageAnswerToSchema, MessageWidgetSchema } from './api/message-widgets.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });
const Payload = Type.Record(Type.String(), Type.Unknown());

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
    requestId: Type.Optional(Nullable(IdSchema)),
    runId: Type.Optional(Nullable(IdSchema)),
    replyLayers: Type.Optional(Nullable(ReplyLayersSchema)),
    disagreement: Type.Optional(Nullable(MessageDisagreementSchema)),
    attachments: Type.Optional(Type.Array(AttachmentRefSchema)),
    active: Type.Optional(Type.Boolean()),
    widgets: Type.Optional(Type.Array(MessageWidgetSchema, { maxItems: MESSAGE_WIDGETS_MAX })),
    answerTo: Type.Optional(Nullable(MessageAnswerToSchema)),
  },
  STRICT,
);
export const MessageSchema = Type.Object({ ...OBJECT_META, ...Type.Required(MessageInputSchema).properties });

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
export const RunSchema = Type.Object({ ...OBJECT_META, ...Type.Required(RunInputSchema).properties });
export type Run = Static<typeof RunSchema>;

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
