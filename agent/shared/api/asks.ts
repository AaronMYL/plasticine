// /v2/asks: 要你定卡（《UI 方案》第 6 节）。一次只有一张摊开（current），其余排在「等你」（queue）。
// 作答：卡收成一行留在原位，线上的卡由新内核把答案交回那条线；先不：收回、不算答；问一句：不选，先在出卡的那条线里问。
// 2026-11-05 Harness 重做：任务、采访、自迭代、判断、启用、归属这些卡没了，它们的字段一起删；卡带上出它的那条线（lineId）。
// Every write carries the client's requestId (约定 1); the card's state reaches the other devices over /v2/events.

import { Type, type Static } from 'typebox';
import { OutboundCardSchema, OutboundGrantInputSchema } from '../outbound.ts';
import { RulesOfferItemSchema } from './rules-doc.ts';
import {
  ASK_KINDS,
  ASK_STATUSES,
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

/** 左上小签的字（第 49 条：授权 / 动手用强调色描边，定 / 确认用中性描边）。 */
export const ASK_KIND_LABELS: Readonly<Record<AskKind, string>> = {
  decide: '要你定',
  confirm: '要你确认',
  approve: '要你授权',
  act: '要你动手',
};

/** 「等你」区的顺序（第 44 条）：动手 > 授权 > 确认 > 定；「下次汇报」档的卡永远排在最后。 */
export const ASK_KIND_ORDER: readonly AskKind[] = ['act', 'approve', 'confirm', 'decide'];

// 第 38 条：2–3 个短选项并排；多于 3 个、或选项要带一句说明时，一行一个。
export const ASK_INLINE_OPTION_MAX = 3;
export const ASK_LAYOUTS = ['inline', 'list'] as const;

/** Plasticine 起草、等你点「发出」的任务卡（硬线：以你的名义发出去）：卡上画成一张任务卡的样子。 */
export const TaskCardPreviewSchema = Type.Object({
  /** 发给谁：一个人的名字和头像，或一个群（members 是拼头像的那几个名字）。 */
  to: Type.Object({
    name: Type.String(),
    avatar: Nullable(Type.String()),
    group: Type.Boolean(),
  }),
  /** 群里指给的那个人；null = 全群谁先接谁做（一对一时也是 null）。 */
  assignee: Nullable(Type.String()),
  title: Type.String(),
  goal: Type.String(),
  deadline: Nullable(Type.String()),
  /** 附的资料：笔记标题。 */
  attachment: Nullable(Type.String()),
});
export type TaskCardPreview = Static<typeof TaskCardPreviewSchema>;

export const AskViewSchema = Type.Object({
  outbound: Type.Optional(OutboundCardSchema),
  /** 旧卡片的兼容标记；如今由本人会话确认，不再要求浏览器签名钥匙。 */
  requiresSignature: Type.Optional(Type.Boolean()),
  /** 起草好的任务卡（发任务卡那件工具的硬线卡）。 */
  taskCard: Type.Optional(TaskCardPreviewSchema),
  /** 起草好的定时卡（《优化清单》第 3 条）：他点确认才生效。 */
  scheduleCard: Type.Optional(ScheduleCardPreviewSchema),
  /** 研究周报样刊附的「开启定时 / 再改改」卡（第 7 批第 14 条）。 */
  subscriptionCard: Type.Optional(SubscriptionCardPreviewSchema),
  collision: Type.Optional(Type.Boolean()),
  why: Type.Optional(Type.String()),
  /** 为什么问（第 5 批「做还是问」）：推出来的 / 有几种可能 / 资料里没有 / 硬线；上线前的旧卡没有。展开依据里放在第一行。 */
  basis: Type.Optional(Nullable(Type.Enum(ASK_BASES))),
  channelReason: Type.Optional(Type.String()),
  feedback: Type.Optional(Nullable(Type.Enum(['appropriate', 'unnecessary']))),
  deviceAction: Type.Optional(Type.Boolean()),
  /** 第 4 批「全部写入」卡：要写进「怎么替你做事」的几条，界面一条一行、单条可去掉。 */
  rulesOffer: Type.Optional(Type.Array(RulesOfferItemSchema)),
  moneyDraftId: Type.Optional(Nullable(IdSchema)),
  restorePreviewId: Type.Optional(Nullable(IdSchema)),
  id: IdSchema,
  kind: Type.Enum(ASK_KINDS),
  kindLabel: Type.String(),
  channel: Type.Enum(CHANNELS),
  /** 一句：要定什么、为什么现在问。 */
  question: Type.String(),
  /** 展开后的依据。 */
  detail: Nullable(Type.String()),
  failure: Type.Optional(Nullable(Type.String())),
  continuation: Type.Optional(Nullable(Type.String())),
  /** 推荐项排第一个（recommended = true，按钮字带「（推荐）」由界面加）。没有选项时就是填一句话。 */
  options: Type.Array(AskOptionSchema),
  layout: Type.Enum(ASK_LAYOUTS),
  status: Type.Enum(ASK_STATUSES),
  answer: Nullable(AskAnswerSchema),
  /** 出这张卡的那条线（线上的 ask_user、硬线、页面提交）；别处出的卡（记账确认、恢复备份、网络）是 null。 */
  lineId: Nullable(IdSchema),
  /** 网络任务卡可直接进入统一工作详情；只投影服务端记录的关联。 */
  networkTaskId: Type.Optional(IdSchema),
  /**
   * 别人 @ 了我的 Plasticine、它拿不准时要我确认怎么回的卡：属于哪段聊天（联系人或群组）、是哪句话问的、打算怎么回。
   * 界面把这张卡直接画在那段聊天里；「这样回」时可以带上改过的字（回答的 text）。
   */
  networkReply: Type.Optional(Type.Object({
    contactId: Nullable(IdSchema),
    groupId: Nullable(IdSchema),
    questionId: Type.String({ minLength: 1 }),
    draft: Nullable(Type.String()),
  }, { additionalProperties: false })),
  createdAt: IsoTimeSchema,
  /** 「先不」的时间：移入暂缓区，不再计入当前待答。 */
  deferredAt: Nullable(IsoTimeSchema),
  answeredAt: Nullable(IsoTimeSchema),
  version: Type.Integer({ minimum: 1 }),
});
export type AskView = Static<typeof AskViewSchema>;

/** 暂缓的卡不再催答（「先不」过的、还开着的）。 */
export function isDeferredStandaloneAsk(ask: Pick<AskView, 'status' | 'deferredAt'>): boolean {
  return ask.status === 'open' && ask.deferredAt !== null;
}

/** GET /v2/asks: current + queue 是当前待答；独立暂缓卡单列，保留原卡以便找回。 */
export const AskListResponseSchema = Type.Object({
  current: Nullable(AskViewSchema),
  queue: Type.Array(AskViewSchema),
  /** 旧服务端未分区时可缺省；新服务端始终返回这个分区。 */
  deferred: Type.Optional(Type.Array(AskViewSchema)),
});
export type AskListResponse = Static<typeof AskListResponseSchema>;

// The same bound as a typed answer on a task row.
export const ASK_TEXT_MAX_CHARS = 2_000;

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
  },
  { additionalProperties: false },
);
export type AnswerAskRequest = Static<typeof AnswerAskRequestSchema>;

/** 200: the answered card and the user's message 「选择：…」 that now stands in the conversation. */
/** 2026-11-05：作答不再在旧对话里留一条「选择：…」，所以不回 message 了。 */
export const AnswerAskResponseSchema = Type.Object({ ask: AskViewSchema });
export type AnswerAskResponse = Static<typeof AnswerAskResponseSchema>;

/** POST /v2/asks/:id/defer → 200 { ask }: 先不。 */
export const DeferAskRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type DeferAskRequest = Static<typeof DeferAskRequestSchema>;
export const DeferAskResponseSchema = Type.Object({ ask: AskViewSchema });
export type DeferAskResponse = Static<typeof DeferAskResponseSchema>;

export const AskFeedbackRequestSchema = Type.Object({ requestId: RequestIdSchema,
  feedback: Type.Enum(['appropriate', 'unnecessary']) }, { additionalProperties: false });
export type AskFeedbackRequest = Static<typeof AskFeedbackRequestSchema>;

/**
 * POST /v2/asks/:id/ask → 202, like sending a message: 问一句。The question goes into the line that raised the card
 * (the main line for others), quoting the card; the card stays open. 回发到了哪条线、是马上开了一轮还是排上了队。
 */
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
