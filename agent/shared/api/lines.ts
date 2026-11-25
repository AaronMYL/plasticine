// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { MessageWidgetAnswerSchema, MessageWidgetSchema } from './message-widgets.ts';
import { CONVERSATION_QUOTE_MAX_COUNT, ConversationQuoteInputSchema } from '../conversation-quotes.ts';
import { LineReplySchema } from '../line-reply.ts';
import { WelcomeStartSchema } from '../welcome-start.ts';

const STRICT = { additionalProperties: false };

export const LINES_PATH = `${API_PREFIX}/lines`;
export const MAIN_LINE_ALIAS = 'main';

export const LINE_KINDS = ['main', 'background', 'side'] as const;
export const LineKindSchema = Type.Enum(LINE_KINDS);
export type LineKind = Static<typeof LineKindSchema>;

export const LINE_STATUSES = ['queued', 'running', 'idle', 'waiting', 'paused', 'failed'] as const;
export const LineStatusSchema = Type.Enum(LINE_STATUSES);
export type LineStatus = Static<typeof LineStatusSchema>;

export const LinePauseReasonSchema = Type.Enum(['user', 'stopped', 'quota', 'output_limit']);
export type LinePauseReason = Static<typeof LinePauseReasonSchema>;
export const LineOutcomeSchema = Type.Enum(['done', 'stopped', 'incomplete', 'failed']);
export type LineOutcome = Static<typeof LineOutcomeSchema>;

export const LineInputOriginSchema = Type.Object({
  kind: Type.Enum(['user', 'delegation', 'trigger', 'network', 'system', 'unknown']),
  ref: Type.Optional(Type.String({ minLength: 1 })),
  userText: Type.Optional(Type.String()),
}, STRICT);
export type LineInputOrigin = Static<typeof LineInputOriginSchema>;

export const QUEUE_STATUSES = ['queued', 'inserted', 'sent', 'withdrawn'] as const;
export const QueueStatusSchema = Type.Enum(QUEUE_STATUSES);
export type QueueStatus = Static<typeof QueueStatusSchema>;

export const LINE_MESSAGE_MAX_CHARS = 20_000;
export const LINE_ATTACHMENTS_MAX = 10;
export const LINE_PAGE_DEFAULT = 50;
export const LINE_PAGE_MAX = 200;
export const LINE_TITLE_MAX_CHARS = 60;

export const LineTopicSchema = Type.Object({
  kind: Type.Enum(['feed', 'message']),
  ref: Type.String({ minLength: 1 }),
  title: Type.String(),
  source: Nullable(Type.String()),
  at: Nullable(IsoTimeSchema),
  excerpt: Type.String(),
}, STRICT);
export type LineTopic = Static<typeof LineTopicSchema>;
export const SIDE_TOPIC_EXCERPT_MAX_CHARS = 4_000;

export const LINE_PLAN_STEPS_MAX = 30;
export const LINE_PLAN_STEP_MAX_CHARS = 80;
export const LinePlanStepSchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: LINE_PLAN_STEP_MAX_CHARS }),
  status: Type.Enum(['todo', 'running', 'done', 'skipped']),
}, STRICT);
export type LinePlanStep = Static<typeof LinePlanStepSchema>;

export const LineViewSchema = Type.Object({
  mateId: Type.Optional(Nullable(IdSchema)),
  mateGroupId: Type.Optional(Nullable(IdSchema)),
  id: IdSchema,
  kind: LineKindSchema,
  parentLineId: Nullable(IdSchema),
  parentMessageSeq: Nullable(Type.Integer({ minimum: 1 })),
  handedOff: Type.Optional(Type.Boolean()),
  projectId: Nullable(IdSchema),
  title: Type.String(),
  status: LineStatusSchema,
  pauseReason: Nullable(LinePauseReasonSchema),
  archivedAt: Type.Optional(Nullable(IsoTimeSchema)),
  outcome: Nullable(LineOutcomeSchema),
  pausedUntil: Nullable(IsoTimeSchema),
  failure: Nullable(Type.String()),
  activity: Nullable(Type.String()),
  activeSince: Nullable(IsoTimeSchema),
  queued: Type.Integer({ minimum: 0 }),
  lastAnswer: Nullable(Type.String()),
  unmet: Type.Optional(Nullable(Type.String())),
  topic: Type.Optional(Nullable(LineTopicSchema)),
  plan: Type.Optional(Nullable(Type.Array(LinePlanStepSchema, { maxItems: LINE_PLAN_STEPS_MAX }))),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
}, STRICT);
export type LineView = Static<typeof LineViewSchema>;

export const LineStepViewSchema = Type.Object({
  toolCallId: Type.String(),
  tool: Type.String(),
  say: Type.String(),
}, STRICT);
export type LineStepView = Static<typeof LineStepViewSchema>;

export const LINE_MESSAGE_ROLES = ['user', 'assistant', 'toolResult', 'lineReport', 'lineSummary', 'notice',
  'welcome', 'letter', 'handoff'] as const;

export const LineSpeakerSchema = Type.Union([
  Type.Object({ kind: Type.Literal('main') }, STRICT),
  Type.Object({ kind: Type.Literal('mate'), id: IdSchema }, STRICT),
]);
export type LineSpeaker = Static<typeof LineSpeakerSchema>;

export const LineRelaySchema = Type.Object({ from: LineSpeakerSchema, to: LineSpeakerSchema }, STRICT);
export type LineRelay = Static<typeof LineRelaySchema>;
export const LineMessageRoleSchema = Type.Enum(LINE_MESSAGE_ROLES);

export const LineMessageViewSchema = Type.Object({
  lineId: IdSchema,
  seq: Type.Integer({ minimum: 1 }),
  role: LineMessageRoleSchema,
  origin: Nullable(LineInputOriginSchema),
  text: Type.String(),
  thinking: Nullable(Type.String()),
  thinkingMs: Nullable(Type.Integer({ minimum: 0 })),
  steps: Type.Array(LineStepViewSchema),
  toolCallId: Nullable(Type.String()),
  tool: Nullable(Type.String()),
  say: Nullable(Type.String()),
  ok: Nullable(Type.Boolean()),
  summary: Nullable(Type.String()),
  stopReason: Nullable(Type.String()),
  childLineId: Nullable(IdSchema),
  attachments: Type.Array(IdSchema),
  widgets: Type.Array(MessageWidgetSchema),
  reactions: Type.Optional(Type.Array(Type.String())),
  replyTo: Type.Optional(Nullable(LineReplySchema)),
  starts: Type.Optional(Type.Array(WelcomeStartSchema)),
  letter: Type.Optional(Type.Object({ spaceId: IdSchema, title: Type.String() }, STRICT)),
  relay: Type.Optional(LineRelaySchema),
  createdAt: IsoTimeSchema,
}, STRICT);
export type LineMessageView = Static<typeof LineMessageViewSchema>;

export const QueuedMessageViewSchema = Type.Object({
  id: IdSchema,
  lineId: IdSchema,
  text: Type.String(),
  origin: LineInputOriginSchema,
  attachments: Type.Array(IdSchema),
  status: QueueStatusSchema,
  createdAt: IsoTimeSchema,
}, STRICT);
export type QueuedMessageView = Static<typeof QueuedMessageViewSchema>;

/** GET /v2/lines?kind=&limit= */
export const ListLinesQuerySchema = Type.Object({
  includeArchived: Type.Optional(Type.Boolean()),
  kind: Type.Optional(LineKindSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LINE_PAGE_MAX })),
}, STRICT);
export type ListLinesQuery = Static<typeof ListLinesQuerySchema>;
export const ListLinesResponseSchema = Type.Object({ lines: Type.Array(LineViewSchema) }, STRICT);
export type ListLinesResponse = Static<typeof ListLinesResponseSchema>;

export const ReadLineQuerySchema = Type.Object({
  before: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LINE_PAGE_MAX })),
}, STRICT);
export const ReadLineResponseSchema = Type.Object({
  line: LineViewSchema,
  messages: Type.Array(LineMessageViewSchema),
  hasMore: Type.Boolean(),
  queue: Type.Array(QueuedMessageViewSchema),
}, STRICT);
export type ReadLineResponse = Static<typeof ReadLineResponseSchema>;

/** POST /v2/lines/:id/messages */
export const SendLineMessageRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  text: Type.String({ maxLength: LINE_MESSAGE_MAX_CHARS }),
  attachments: Type.Optional(Type.Array(IdSchema, { maxItems: LINE_ATTACHMENTS_MAX })),
  quotes: Type.Optional(Type.Array(ConversationQuoteInputSchema, { maxItems: CONVERSATION_QUOTE_MAX_COUNT })),
  replyTo: Type.Optional(Type.Object({ seq: Type.Integer({ minimum: 1 }) }, STRICT)),
}, STRICT);
export type SendLineMessageRequest = Static<typeof SendLineMessageRequestSchema>;
export const SendLineMessageResponseSchema = Type.Object({
  line: LineViewSchema,
  outcome: Type.Enum(['started', 'queued']),
  message: Nullable(LineMessageViewSchema),
  queued: Nullable(QueuedMessageViewSchema),
}, STRICT);
export type SendLineMessageResponse = Static<typeof SendLineMessageResponseSchema>;

export const LineCommandRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type LineCommandRequest = Static<typeof LineCommandRequestSchema>;
export const LineQueueResponseSchema = Type.Object({
  line: LineViewSchema,
  item: QueuedMessageViewSchema,
}, STRICT);
export type LineQueueResponse = Static<typeof LineQueueResponseSchema>;
export const LineResponseSchema = Type.Object({ line: LineViewSchema }, STRICT);
export type LineResponse = Static<typeof LineResponseSchema>;

export const AnswerLineWidgetRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  widgetId: IdSchema,
  answer: MessageWidgetAnswerSchema,
}, STRICT);
export type AnswerLineWidgetRequest = Static<typeof AnswerLineWidgetRequestSchema>;
export const AnswerLineWidgetResponseSchema = Type.Object({
  line: LineViewSchema,
  message: LineMessageViewSchema,
  outcome: Type.Enum(['started', 'queued', 'recorded']),
}, STRICT);
export type AnswerLineWidgetResponse = Static<typeof AnswerLineWidgetResponseSchema>;

export const LINE_REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀'] as const;
export const LineReactionSchema = Type.Enum(LINE_REACTIONS);

export const ReactLineMessageRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  seq: Type.Integer({ minimum: 1 }),
  emoji: LineReactionSchema,
  on: Type.Boolean(),
}, STRICT);
export type ReactLineMessageRequest = Static<typeof ReactLineMessageRequestSchema>;
export const ReactLineMessageResponseSchema = Type.Object({ message: LineMessageViewSchema }, STRICT);
export type ReactLineMessageResponse = Static<typeof ReactLineMessageResponseSchema>;

export const SideFromSchema = Type.Union([
  Type.Object({ kind: Type.Literal('feed'), itemId: IdSchema }, STRICT),
  Type.Object({ kind: Type.Literal('message'), lineId: IdSchema, seq: Type.Integer({ minimum: 1 }) }, STRICT),
]);
export type SideFrom = Static<typeof SideFromSchema>;
export const OpenSideRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  title: Type.Optional(Type.String({ minLength: 1, maxLength: LINE_TITLE_MAX_CHARS })),
  from: Type.Optional(SideFromSchema),
}, STRICT);
export type OpenSideRequest = Static<typeof OpenSideRequestSchema>;
export const SIDE_PATH = `${LINES_PATH}/side`;
export const BLANK_SIDE_TITLE = '新旁聊';

export const CHATS_PATH = `${LINES_PATH}/chats`;
export const ChatsResponseSchema = Type.Object({
  main: Type.Object({ line: LineViewSchema, status: Nullable(Type.String()) }, STRICT),
  sides: Type.Array(LineViewSchema),
}, STRICT);
export type ChatsResponse = Static<typeof ChatsResponseSchema>;

export const linePath = (lineId: string): string => `${LINES_PATH}/${encodeURIComponent(lineId)}`;
export const lineMessagesPath = (lineId: string): string => `${linePath(lineId)}/messages`;
export const lineWidgetsPath = (lineId: string): string => `${linePath(lineId)}/widgets`;
export const lineReactionsPath = (lineId: string): string => `${linePath(lineId)}/reactions`;
export const lineQueuePath = (lineId: string, queueId: string): string =>
  `${linePath(lineId)}/queue/${encodeURIComponent(queueId)}`;

export const LineChangedEventSchema = Type.Object({
  type: Type.Literal('line_changed'),
  line: LineViewSchema,
}, STRICT);

export const LineTextEventSchema = Type.Object({
  type: Type.Literal('line_text'),
  lineId: IdSchema,
  delta: Type.String(),
}, STRICT);

export const LineThinkingEventSchema = Type.Object({
  type: Type.Literal('line_thinking'),
  lineId: IdSchema,
  delta: Type.String(),
}, STRICT);

export const LineToolEventSchema = Type.Object({
  type: Type.Literal('line_tool'),
  lineId: IdSchema,
  phase: Type.Enum(['started', 'ended']),
  toolCallId: Type.String(),
  tool: Type.String(),
  say: Type.String(),
  ok: Nullable(Type.Boolean()),
  summary: Nullable(Type.String()),
  durationMs: Nullable(Type.Integer({ minimum: 0 })),
}, STRICT);

export const LineMessageEventSchema = Type.Object({
  type: Type.Literal('line_message'),
  message: LineMessageViewSchema,
}, STRICT);

export const LineQueueEventSchema = Type.Object({
  type: Type.Literal('line_queue'),
  lineId: IdSchema,
  queue: Type.Array(QueuedMessageViewSchema),
}, STRICT);

export const LineStreamEventSchema = Type.Union([
  LineChangedEventSchema,
  LineTextEventSchema,
  LineThinkingEventSchema,
  LineToolEventSchema,
  LineMessageEventSchema,
  LineQueueEventSchema,
]);
export type LineStreamEvent = Static<typeof LineStreamEventSchema>;
