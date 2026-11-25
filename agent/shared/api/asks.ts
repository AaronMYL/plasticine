import { Type, type Static } from 'typebox';
import { OutboundCardSchema, OutboundGrantInputSchema } from '../outbound.ts';
import { RulesOfferItemSchema } from './rules-doc.ts';
import {
  ASK_KINDS,
  ASK_STATUSES,
  AskAnswerPlaceSchema,
  AskAnswerSchema,
  AskOptionSchema,
  CHANNELS,
  Nullable,
  type AskKind,
} from '../state.ts';
import { ASK_BASES } from '../act-or-ask.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { ScheduleCardPreviewSchema, SubscriptionCardPreviewSchema } from './schedule-card.ts';
import { LINE_MESSAGE_MAX_CHARS } from './lines.ts';

export const ASKS_PATH = `${API_PREFIX}/asks`;

export { ASK_BASES, ASK_BASIS_LABELS, ASK_BASIS_MEANINGS, HARD_LINES, type AskBasis } from '../act-or-ask.ts';

export const ASK_KIND_LABELS: Readonly<Record<AskKind, string>> = {
  decide: '等你定',
  confirm: '等你确认',
  approve: '等你授权',
  act: '等你动手',
};

export const ASK_KIND_ORDER: readonly AskKind[] = ['act', 'approve', 'confirm', 'decide'];

export const ASK_INLINE_OPTION_MAX = 3;
export const ASK_LAYOUTS = ['inline', 'list'] as const;

export const TaskCardPreviewSchema = Type.Object({
  to: Type.Object({
    name: Type.String(),
    avatar: Nullable(Type.String()),
    group: Type.Boolean(),
  }),
  assignee: Nullable(Type.String()),
  title: Type.String(),
  goal: Type.String(),
  deadline: Nullable(Type.String()),
  attachment: Nullable(Type.String()),
});
export type TaskCardPreview = Static<typeof TaskCardPreviewSchema>;

export const AskViewSchema = Type.Object({
  outbound: Type.Optional(OutboundCardSchema),
  requiresSignature: Type.Optional(Type.Boolean()),
  taskCard: Type.Optional(TaskCardPreviewSchema),
  scheduleCard: Type.Optional(ScheduleCardPreviewSchema),
  subscriptionCard: Type.Optional(SubscriptionCardPreviewSchema),
  collision: Type.Optional(Type.Boolean()),
  why: Type.Optional(Type.String()),
  basis: Type.Optional(Nullable(Type.Enum(ASK_BASES))),
  channelReason: Type.Optional(Type.String()),
  feedback: Type.Optional(Nullable(Type.Enum(['appropriate', 'unnecessary']))),
  deviceAction: Type.Optional(Type.Boolean()),
  rulesOffer: Type.Optional(Type.Array(RulesOfferItemSchema)),
  moneyDraftId: Type.Optional(Nullable(IdSchema)),
  restorePreviewId: Type.Optional(Nullable(IdSchema)),
  id: IdSchema,
  kind: Type.Enum(ASK_KINDS),
  kindLabel: Type.String(),
  channel: Type.Enum(CHANNELS),
  question: Type.String(),
  detail: Nullable(Type.String()),
  failure: Type.Optional(Nullable(Type.String())),
  continuation: Type.Optional(Nullable(Type.String())),
  options: Type.Array(AskOptionSchema),
  layout: Type.Enum(ASK_LAYOUTS),
  status: Type.Enum(ASK_STATUSES),
  answer: Nullable(AskAnswerSchema),
  lineId: Nullable(IdSchema),
  networkTaskId: Type.Optional(IdSchema),
  networkReply: Type.Optional(Type.Object({
    contactId: Nullable(IdSchema),
    groupId: Nullable(IdSchema),
    questionId: Type.String({ minLength: 1 }),
    draft: Nullable(Type.String()),
    self: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false })),
  createdAt: IsoTimeSchema,
  deferredAt: Nullable(IsoTimeSchema),
  answeredAt: Nullable(IsoTimeSchema),
  version: Type.Integer({ minimum: 1 }),
});
export type AskView = Static<typeof AskViewSchema>;

export function isDeferredStandaloneAsk(ask: Pick<AskView, 'status' | 'deferredAt'>): boolean {
  return ask.status === 'open' && ask.deferredAt !== null;
}

export const AskListResponseSchema = Type.Object({
  current: Nullable(AskViewSchema),
  queue: Type.Array(AskViewSchema),
  deferred: Type.Optional(Type.Array(AskViewSchema)),
  recent: Type.Optional(Type.Array(AskViewSchema)),
});
export type AskListResponse = Static<typeof AskListResponseSchema>;

export const ASK_TEXT_MAX_CHARS = 2_000;
export const RECENT_ASK_DAYS = 3;

/**
 * POST /v2/asks/:id/answer. A card with options needs `optionId` (`text` may add a sentence); a card without
 * options needs `text`. Answering a card that is already answered or withdrawn is 409 `ask_closed`.
 */
export const AnswerAskRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    outboundGrant: Type.Optional(OutboundGrantInputSchema),
    optionId: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    text: Type.Optional(Type.String({ minLength: 1, maxLength: ASK_TEXT_MAX_CHARS })),
    place: Type.Optional(AskAnswerPlaceSchema),
  },
  { additionalProperties: false },
);
export type AnswerAskRequest = Static<typeof AnswerAskRequestSchema>;

export const AnswerAskResponseSchema = Type.Object({ ask: AskViewSchema });
export type AnswerAskResponse = Static<typeof AnswerAskResponseSchema>;

export const DeferAskRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type DeferAskRequest = Static<typeof DeferAskRequestSchema>;
export const DeferAskResponseSchema = Type.Object({ ask: AskViewSchema });
export type DeferAskResponse = Static<typeof DeferAskResponseSchema>;

export const AskFeedbackRequestSchema = Type.Object({ requestId: RequestIdSchema,
  feedback: Type.Enum(['appropriate', 'unnecessary']) }, { additionalProperties: false });
export type AskFeedbackRequest = Static<typeof AskFeedbackRequestSchema>;

export const AskAboutRequestSchema = Type.Object(
  { requestId: RequestIdSchema, text: Type.String({ minLength: 1, maxLength: LINE_MESSAGE_MAX_CHARS }) },
  { additionalProperties: false },
);
export type AskAboutRequest = Static<typeof AskAboutRequestSchema>;
export const AskAboutResponseSchema = Type.Object({
  lineId: IdSchema,
  outcome: Type.Union([Type.Literal('started'), Type.Literal('queued')]),
});
export type AskAboutResponse = Static<typeof AskAboutResponseSchema>;
