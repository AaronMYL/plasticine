// SPDX-License-Identifier: Apache-2.0
// 新内核的「线」（2026-11-05 Harness 重做）：接口和事件的形状，服务端校验、客户端导类型都从这里来。
// 一条线 = 一段连续的工作：主对话是固定的 main 线，耗时的事开后台线去做。线空闲时发消息 = 开一轮；线在跑时发消息
// = 进排队，这一轮结束后按顺序发出；「立即发送」把排队的一条插进正在跑的这一轮；叫停 = 中止这一轮。
// 事件走现有的 /v2/events（同一个 event hub、同样的 Last-Event-ID 补发）；旧客户端不认识这些事件名，EventSource
// 不派发，不受影响。所以它们不并进 EveryStreamEventSchema（那份是旧客户端逐个登记的全集），另成 LineStreamEventSchema。

import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { MessageWidgetAnswerSchema, MessageWidgetSchema } from './message-widgets.ts';
import { CONVERSATION_QUOTE_MAX_COUNT, ConversationQuoteInputSchema } from '../conversation-quotes.ts';
import { LineReplySchema } from '../line-reply.ts';
import { WelcomeStartSchema } from '../welcome-start.ts';

const STRICT = { additionalProperties: false };

export const LINES_PATH = `${API_PREFIX}/lines`;
/** 路径里写 main 就是主对话那条线，客户端不用先查它的 id。 */
export const MAIN_LINE_ALIAS = 'main';

// 以后（网络第二阶段）还会有「网络任务」和「替主人在某段聊天里回答」两种线：后者按对方档位过滤资料、不能动手。
// 库里 kind 不写 CHECK（迁移 0058），加一项只改这里；工具按 LineScope.kind 决定给不给。
// side 是旁聊（《优化清单》第 17 条）：他把一个话题从主线拎出去单独聊，和主线同一套机制（按天分段、记忆库兜底）。
export const LINE_KINDS = ['main', 'background', 'side'] as const;
export const LineKindSchema = Type.Enum(LINE_KINDS);
export type LineKind = Static<typeof LineKindSchema>;

/**
 * queued 等后台空位；running 在跑；idle 空闲；waiting 等他定；paused 暂停（只有 quota 到点自动继续）；
 * failed 重试过还是不行，等他点重试。
 */
export const LINE_STATUSES = ['queued', 'running', 'idle', 'waiting', 'paused', 'failed'] as const;
export const LineStatusSchema = Type.Enum(LINE_STATUSES);
export type LineStatus = Static<typeof LineStatusSchema>;

export const LinePauseReasonSchema = Type.Enum(['user', 'quota', 'output_limit']);
export type LinePauseReason = Static<typeof LinePauseReasonSchema>;
export const LineOutcomeSchema = Type.Enum(['done', 'stopped', 'incomplete', 'failed']);
export type LineOutcome = Static<typeof LineOutcomeSchema>;

/** 模型接口的 user role 不是来源身份；只有真正的用户输入才能成为「他说过」的记忆来源。 */
export const LineInputOriginSchema = Type.Object({
  kind: Type.Enum(['user', 'delegation', 'trigger', 'network', 'system', 'unknown']),
  /** 可选原始消息引用；引用本身仍需服务端核对来源身份。 */
  ref: Type.Optional(Type.String({ minLength: 1 })),
  /** 用户输入本身，不含服务端拼入的笔记、图书等引用材料。 */
  userText: Type.Optional(Type.String()),
}, STRICT);
export type LineInputOrigin = Static<typeof LineInputOriginSchema>;

// inserted：线在跑时点了「立即发送」，交给这一轮了（这一步做完插进去），还没写进库；重启后照排队的发。
export const QUEUE_STATUSES = ['queued', 'inserted', 'sent', 'withdrawn'] as const;
export const QueueStatusSchema = Type.Enum(QUEUE_STATUSES);
export type QueueStatus = Static<typeof QueueStatusSchema>;

// 一条消息最多这么长：和旧对话一样，再长的材料走附件。
export const LINE_MESSAGE_MAX_CHARS = 20_000;
export const LINE_ATTACHMENTS_MAX = 10;
// 读一条线一页的条数：《实施方案》第 5 节「往上 50 条」。
export const LINE_PAGE_DEFAULT = 50;
export const LINE_PAGE_MAX = 200;
export const LINE_TITLE_MAX_CHARS = 60;

/** 旁聊围绕的那一条：信息流条目（ref 是条目 id）或主线里的一句（ref 是 line:<线>:<seq>）。 */
export const LineTopicSchema = Type.Object({
  kind: Type.Enum(['feed', 'message']),
  ref: Type.String({ minLength: 1 }),
  title: Type.String(),
  /** 信息流的来源（bioRxiv）；主线里的一句是 null。 */
  source: Nullable(Type.String()),
  /** 条目发布的时间。 */
  at: Nullable(IsoTimeSchema),
  /** 那一条的摘要或那一句的原话（开旁聊时带进去的内容）。 */
  excerpt: Type.String(),
}, STRICT);
export type LineTopic = Static<typeof LineTopicSchema>;
export const SIDE_TOPIC_EXCERPT_MAX_CHARS = 4_000;

export const LineViewSchema = Type.Object({
  mateId: Type.Optional(Nullable(IdSchema)),
  mateGroupId: Type.Optional(Nullable(IdSchema)),
  id: IdSchema,
  kind: LineKindSchema,
  parentLineId: Nullable(IdSchema),
  /** 发起它的父线消息；旧记录没有可靠关联时是 null。用于让任务卡留在发起的位置。 */
  parentMessageSeq: Nullable(Type.Integer({ minimum: 1 })),
  projectId: Nullable(IdSchema),
  title: Type.String(),
  status: LineStatusSchema,
  pauseReason: Nullable(LinePauseReasonSchema),
  /** 归档保留历史，默认列表隐藏；恢复不会自动执行。旧客户端记录缺省表示未归档。 */
  archivedAt: Type.Optional(Nullable(IsoTimeSchema)),
  /** 当前这一轮的结束结果；有新输入在等时不是 done。 */
  outcome: Nullable(LineOutcomeSchema),
  /** 额度用完时到这个时间再接着跑。 */
  pausedUntil: Nullable(IsoTimeSchema),
  /** failed / paused 的一句话原因（中文），重试中时是「连不上模型，第 2 次重试…」。 */
  failure: Nullable(Type.String()),
  /** 在跑时的一行实时状态（大白话，例如「在 Mac 上读 CuaDriver 的签名…」）。 */
  activity: Nullable(Type.String()),
  /** 这一轮从什么时候开始跑（界面上的已用时间）。 */
  activeSince: Nullable(IsoTimeSchema),
  /** 排队等发的条数。 */
  queued: Type.Integer({ minimum: 0 }),
  /** 最后一段回答的开头（后台线卡片上的结果预览）。 */
  lastAnswer: Nullable(Type.String()),
  /**
   * 这一轮跑完了（outcome done），但线自己说事没做成（line_outcome）：一句原因。做成了、没说过（旧记录）是 null，
   * 照旧按做完显示。旧客户端缓存里没有这一项。
   */
  unmet: Type.Optional(Nullable(Type.String())),
  /** 旁聊围绕的那一条；别的线是 null。旧客户端缓存里没有这一项。 */
  topic: Type.Optional(Nullable(LineTopicSchema)),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
}, STRICT);
export type LineView = Static<typeof LineViewSchema>;

/** 一轮里的一步：工具调用，带它自己声明的大白话。 */
export const LineStepViewSchema = Type.Object({
  toolCallId: Type.String(),
  tool: Type.String(),
  say: Type.String(),
}, STRICT);
export type LineStepView = Static<typeof LineStepViewSchema>;

/**
 * notice：系统发在主线上的通知（《优化清单》第 12 条），origin 是 system，summary 是系统通知里那一句。
 * welcome：建账号成功时 Plasticine 在主线上打的招呼（2026-11-08《首次使用流程》）：固定文案、不调模型；text 是那句话，
 * starts 是下面三个能点的「开始」，origin 是 null（和回答一样是 Plasticine 说的，不是他说的）。
 * letter：来信（第 8 批第 6 条）：个人回顾写成来信后 Plasticine 在主线说的一句，下面带来信卡（letter）。
 */
export const LINE_MESSAGE_ROLES = ['user', 'assistant', 'toolResult', 'lineReport', 'lineSummary', 'notice',
  'welcome', 'letter'] as const;
export const LineMessageRoleSchema = Type.Enum(LINE_MESSAGE_ROLES);

export const LineMessageViewSchema = Type.Object({
  lineId: IdSchema,
  seq: Type.Integer({ minimum: 1 }),
  role: LineMessageRoleSchema,
  /** user 是模型协议角色；来源身份另记。旧输入未知来源用 unknown，非输入消息是 null。 */
  origin: Nullable(LineInputOriginSchema),
  /** 正文：用户的话、回答的文字、工具结果的文字（截短）、后台线贴回来的结果。 */
  text: Type.String(),
  /** 回答前想了什么（思考摘要），没有是 null。 */
  thinking: Nullable(Type.String()),
  /** 想了多久（毫秒，从第一段思考到开始回答或调工具）；没想、或旧消息没记是 null。 */
  thinkingMs: Nullable(Type.Integer({ minimum: 0 })),
  /** 这条回答里调的工具。 */
  steps: Type.Array(LineStepViewSchema),
  /** 工具结果：对应哪一步、成没成。 */
  toolCallId: Nullable(Type.String()),
  tool: Nullable(Type.String()),
  say: Nullable(Type.String()),
  ok: Nullable(Type.Boolean()),
  /** 工具结果的那一句（和实时的 line_tool 结束时一样）；旧消息没记是 null。 */
  summary: Nullable(Type.String()),
  /**
   * 回答怎么停的（stop / toolUse / length / error / aborted）；后台线贴回的结果是 done / failed / paused，跑完了但
   * 线说没做成是 unmet（ok 是 false）。
   */
  stopReason: Nullable(Type.String()),
  /** 后台线贴回来的结果：是哪条线。 */
  childLineId: Nullable(IdSchema),
  attachments: Type.Array(IdSchema),
  /** 放在回复下面的卡片小部件（show_widgets 的结果带出来）。 */
  widgets: Type.Array(MessageWidgetSchema),
  /** 他给这一条加的表情反应（存下来）。旧客户端缓存里没有这一项。 */
  reactions: Type.Optional(Type.Array(Type.String())),
  /** 他这句是针对哪一条回的（「回复 Plasticine：……」）；不是回复是 null。 */
  replyTo: Type.Optional(Nullable(LineReplySchema)),
  /**
   * welcome 那一条下面的「开始」（按顺序画；点了把 prompt 当他说的话发进主线）。别的角色没有这一项；旧客户端缓存里
   * 也没有。
   */
  starts: Type.Optional(Type.Array(WelcomeStartSchema)),
  /** letter 那一条下面的来信卡：点了打开那封信。别的角色没有这一项；旧客户端缓存里也没有。 */
  letter: Type.Optional(Type.Object({ spaceId: IdSchema, title: Type.String() }, STRICT)),
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

// —— 接口 ——

/** GET /v2/lines?kind=&limit= */
export const ListLinesQuerySchema = Type.Object({
  includeArchived: Type.Optional(Type.Boolean()),
  kind: Type.Optional(LineKindSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LINE_PAGE_MAX })),
}, STRICT);
export type ListLinesQuery = Static<typeof ListLinesQuerySchema>;
export const ListLinesResponseSchema = Type.Object({ lines: Type.Array(LineViewSchema) }, STRICT);
export type ListLinesResponse = Static<typeof ListLinesResponseSchema>;

/** GET /v2/lines/:id?before=<seq>&limit= ：最新的一页，往上翻带 before。消息按 seq 从旧到新。 */
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
  /** 只带引用时可以是空的；文字、附件、引用至少有一样。 */
  text: Type.String({ maxLength: LINE_MESSAGE_MAX_CHARS }),
  attachments: Type.Optional(Type.Array(IdSchema, { maxItems: LINE_ATTACHMENTS_MAX })),
  /** 引用的笔记或书里的一段（原来对话里的引用，2026-11-05 搬到线上）：服务端核对原文后拼进这句话。 */
  quotes: Type.Optional(Type.Array(ConversationQuoteInputSchema, { maxItems: CONVERSATION_QUOTE_MAX_COUNT })),
  /** 针对这条线里的哪一条回复（Muse 的「回复」）：服务端按 seq 取那一条的作者和开头。 */
  replyTo: Type.Optional(Type.Object({ seq: Type.Integer({ minimum: 1 }) }, STRICT)),
}, STRICT);
export type SendLineMessageRequest = Static<typeof SendLineMessageRequestSchema>;
export const SendLineMessageResponseSchema = Type.Object({
  line: LineViewSchema,
  /** started：线空闲，这句话已开了一轮；queued：线在跑，排在 queued 里，这一轮结束后发出。 */
  outcome: Type.Enum(['started', 'queued']),
  message: Nullable(LineMessageViewSchema),
  queued: Nullable(QueuedMessageViewSchema),
}, STRICT);
export type SendLineMessageResponse = Static<typeof SendLineMessageResponseSchema>;

/** 撤回、立即发送、叫停、重试：都只带 requestId。 */
export const LineCommandRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type LineCommandRequest = Static<typeof LineCommandRequestSchema>;
export const LineQueueResponseSchema = Type.Object({
  line: LineViewSchema,
  item: QueuedMessageViewSchema,
}, STRICT);
export type LineQueueResponse = Static<typeof LineQueueResponseSchema>;
export const LineResponseSchema = Type.Object({ line: LineViewSchema }, STRICT);
export type LineResponse = Static<typeof LineResponseSchema>;

/**
 * POST /v2/lines/:id/widgets：答回答下面的一个卡片小部件。答案和状态写回那一步；选项、输入框、确认的答案作为一句话
 * 发进这条线（线在跑就排队），记账卡点确认才记上、撤销拿掉（只记结果，不开一轮）。
 */
export const AnswerLineWidgetRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  widgetId: IdSchema,
  answer: MessageWidgetAnswerSchema,
}, STRICT);
export type AnswerLineWidgetRequest = Static<typeof AnswerLineWidgetRequestSchema>;
export const AnswerLineWidgetResponseSchema = Type.Object({
  line: LineViewSchema,
  /** 部件所在那一步，答案已写回。 */
  message: LineMessageViewSchema,
  /** started / queued：答案作为一句话开了一轮或排上了；recorded：记账卡只记结果。 */
  outcome: Type.Enum(['started', 'queued', 'recorded']),
}, STRICT);
export type AnswerLineWidgetResponse = Static<typeof AnswerLineWidgetResponseSchema>;

/** 表情反应：一条消息上能加的几种（Muse 的悬停条「表情」）。 */
export const LINE_REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀'] as const;
export const LineReactionSchema = Type.Enum(LINE_REACTIONS);

/** POST /v2/lines/:id/reactions：给一条消息加上或拿掉一个表情。 */
export const ReactLineMessageRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  seq: Type.Integer({ minimum: 1 }),
  emoji: LineReactionSchema,
  on: Type.Boolean(),
}, STRICT);
export type ReactLineMessageRequest = Static<typeof ReactLineMessageRequestSchema>;
export const ReactLineMessageResponseSchema = Type.Object({ message: LineMessageViewSchema }, STRICT);
export type ReactLineMessageResponse = Static<typeof ReactLineMessageResponseSchema>;

/**
 * POST /v2/lines/side：开一条旁聊。从信息流条目开（「讨论」）带上那一条；从主线里的一句开（「挪到旁聊」）带上那一句；
 * 都不带是空白的旁聊，第一句话发出后用它起标题。
 */
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
/** 空白旁聊的标题；第一句话发出后换成那句话的开头。 */
export const BLANK_SIDE_TITLE = '新旁聊';

/** GET /v2/lines/chats：第二栏用。主线置顶带最新一行状态，下面是旁聊（标题、时间），最近动过的在前。 */
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

// —— 事件（/v2/events 上的事件名就是 type） ——

/** 线变了：状态、实时状态那一行、排队条数、失败原因。 */
export const LineChangedEventSchema = Type.Object({
  type: Type.Literal('line_changed'),
  line: LineViewSchema,
}, STRICT);

/** 回答的文字增量。 */
export const LineTextEventSchema = Type.Object({
  type: Type.Literal('line_text'),
  lineId: IdSchema,
  delta: Type.String(),
}, STRICT);

/** 思考摘要的增量。 */
export const LineThinkingEventSchema = Type.Object({
  type: Type.Literal('line_thinking'),
  lineId: IdSchema,
  delta: Type.String(),
}, STRICT);

/** 一步开始 / 结束：带工具自己声明的大白话；结束时带成没成和结果的一句摘要。 */
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

/** 一条消息写进了库（用户的话、回答、工具结果、后台线贴回的结果）。 */
export const LineMessageEventSchema = Type.Object({
  type: Type.Literal('line_message'),
  message: LineMessageViewSchema,
}, STRICT);

/** 排队的消息变了（加了、撤了、发出了）：整份排队。 */
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
