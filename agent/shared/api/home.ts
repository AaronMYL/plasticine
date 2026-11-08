// /v2/home：首页（2026-11-02 第 102 条，「今日」改名「首页」）。首页是 Plasticine 的总览：每次打开或回来时，
// 此刻最值得看、最值得做的是什么，点一下就进去。不用固定模块，三层：
//   pinned  钉住层，不参与排序：要你定、订阅要重新登录、任务连续失败（第 2 批：界面上叫「等你」，列全部）；
//   now     「此刻」1–3 张大卡：Plasticine 按上下文挑，每张配一句人话（reason）说明为什么现在看它；
//   rest    其余：按紧急、相关、新鲜、用户过去的反应打分排（score）。
// 候选卡来自各个视图（kind）。每张卡能看「为什么在这」（why + score），能点「少给我看这类」（feedback）。
// 手机首页更短，偏审批、采集、接着读；电脑偏工作——由 device 决定，服务端按设备挑。
// 用户正看着时不重排：客户端拿到新的一份只在顶上插一条新来的急事，用户点了才换（views/home/home-store.ts）。
// 2026-11-04 第 2 批：首页只摆 回来汇报 · 等你（pinned）· 在做（doing）；「事」不在界面出现，now / rest 照算、界面不摆。
// 真接口在 agent/src/app/home.ts（排序公式以那里为准）；观察模式 11-02 改定不用了，observations 恒为空、
// /v2/home/observations/:id 回 404，字段留着只为不改旧 schema。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { ProjectTagSchema } from './project-tag.ts';
import { BriefItemViewSchema, ReturnBriefViewSchema, TodayNumbersSchema } from './today.ts';

export const HOME_PATH = `${API_PREFIX}/home`;
export const HOME_FEEDBACK_PATH = `${HOME_PATH}/feedback`;
export const HOME_OBSERVATIONS_PATH = `${HOME_PATH}/observations`;

/**
 * 候选卡从哪里来。前三种只进钉住层；observe = 观察模式（Plasticine 本来会做的几件事，看一眼对不对），
 * trial = 静默试做出了有价值的结果（例如「已复现并修好了 X」）；change = 十件事里的一条变化。
 */
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

/** 钉住层只收这三种（第 102 条）。 */
export const HOME_PINNED_KINDS: readonly HomeCardKind[] = ['decide', 'reauth', 'task_failing'];

export const HOME_LAYERS = ['pinned', 'now', 'rest'] as const;
export const HOME_DEVICES = ['desktop', 'phone'] as const;

/** 「此刻」最多 3 张（第 102 条）。 */
export const HOME_NOW_MAX = 3;

/**
 * 点一下去哪：一张卡、一项任务、一个项目、一本书、一篇笔记、一条信息流、一件事、一个工具、一个网址、设置、
 * 观察模式那几条、十件事里的一条变化（在首页就地展开：去向、依据、「在对话里提」「有差异」，点开算看过）。
 */
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
  /** 对象 id；tool 是工具名，web 是网址，settings 是设置的小节名。 */
  ref: Type.String({ minLength: 1 }),
});
export type HomeTarget = Static<typeof HomeTargetSchema>;

/** 四个分量各在 0–1；total 是服务端合起来的分，界面只用来排序和在「为什么在这」里显示，不当可信度。 */
export const HomeScoreSchema = Type.Object({
  urgency: Type.Number({ minimum: 0, maximum: 1 }),
  relevance: Type.Number({ minimum: 0, maximum: 1 }),
  freshness: Type.Number({ minimum: 0, maximum: 1 }),
  reaction: Type.Number({ minimum: 0, maximum: 1 }),
  total: Type.Number({ minimum: 0 }),
});
export type HomeScore = Static<typeof HomeScoreSchema>;

/** 观察模式里的一条：Plasticine 本来会做的事，只记下、没真做。 */
export const HomeObservationSchema = Type.Object({
  id: IdSchema,
  text: Type.String({ minLength: 1 }),
  at: IsoTimeSchema,
  verdict: OrNull(Type.Union([Type.Literal('right'), Type.Literal('wrong')])),
});
export type HomeObservation = Static<typeof HomeObservationSchema>;

export const HomeCardSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(HOME_CARD_KINDS),
  /** 卡上的类别小字，例如「图书 · 接着读」。 */
  kindLabel: Type.String({ minLength: 1 }),
  layer: Type.Enum(HOME_LAYERS),
  title: Type.String({ minLength: 1 }),
  detail: OrNull(Type.String()),
  /** 「此刻」卡必有：一句人话说明为什么现在看它（Plasticine 写的）。 */
  reason: OrNull(Type.String()),
  /** 「为什么在这」：一句说明它为什么进了首页。 */
  why: Type.String({ minLength: 1 }),
  score: HomeScoreSchema,
  project: OrNull(ProjectTagSchema),
  target: HomeTargetSchema,
  /** 主动作的字，例如「接着读」「去定」「继续」。 */
  actionLabel: Type.String({ minLength: 1 }),
  /** 一行等宽小字：进度、时间、金额这类。 */
  meta: OrNull(Type.String()),
  /** 0–1 的进度（书读到哪、任务走到哪）；没有就是 null。 */
  progress: OrNull(Type.Number({ minimum: 0, maximum: 1 })),
  /** 第 2 批：等你那一行对着一个人（Cyber Hunter 上的联系人等你回）时，他名字的第一个字，画成圆头像；别的没有。 */
  avatar: Type.Optional(OrNull(Type.String({ minLength: 1, maxLength: 2 }))),
  /** 观察模式那张卡带着这几条；别的卡是空数组。 */
  observations: Type.Array(HomeObservationSchema),
  updatedAt: IsoTimeSchema,
});
export type HomeCard = Static<typeof HomeCardSchema>;

export const HomeQuerySchema = Type.Object(
  { tz: Type.Optional(TimeZoneSchema), device: Type.Optional(Type.Enum(HOME_DEVICES)) },
  { additionalProperties: false },
);
export type HomeQuery = Static<typeof HomeQuerySchema>;

export const HomeResponseSchema = Type.Object({
  date: Type.String(),
  timeZone: Type.String(),
  device: Type.Enum(HOME_DEVICES),
  generatedAt: IsoTimeSchema,
  pinned: Type.Array(HomeCardSchema),
  now: Type.Array(HomeCardSchema, { maxItems: HOME_NOW_MAX }),
  rest: Type.Array(HomeCardSchema),
  /** 等你的事比钉住层显示的多出几件。第 2 批起首页是全站唯一列出等你的地方，钉住层列全部，这里恒为 0。 */
  pinnedMore: Type.Integer({ minimum: 0 }),
  /** 用户点过「少给我看这类」的类别，按次数排。 */
  quieter: Type.Array(Type.Object({ kind: Type.Enum(HOME_CARD_KINDS), times: Type.Integer({ minimum: 1 }) })),
  /** 离开几小时或几天回来时的四句话，在最上面（沿用今日的回来汇报）。 */
  returnBrief: OrNull(ReturnBriefViewSchema),
  /** 最底下一行今天的数（沿用今日）。 */
  numbers: TodayNumbersSchema,
  /**
   * 「变化」卡（十件事里的一条）背后的那一条：卡就地展开要它的版本、看过没有、差异待核对（2026-11-03 去掉旧版今日后，
   * 依据和「有差异」都在首页做）。只含这一份里有卡的那几条。
   */
  changes: Type.Array(BriefItemViewSchema),
});
export type HomeResponse = Static<typeof HomeResponseSchema>;

/** POST /v2/home/feedback：「少给我看这类」或撤销。 */
export const HomeFeedbackRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    cardId: IdSchema,
    kind: Type.Enum(HOME_CARD_KINDS),
    action: Type.Union([Type.Literal('less'), Type.Literal('undo_less')]),
  },
  { additionalProperties: false },
);
export type HomeFeedbackRequest = Static<typeof HomeFeedbackRequestSchema>;

export const HomeFeedbackResponseSchema = Type.Object({
  kind: Type.Enum(HOME_CARD_KINDS),
  times: Type.Integer({ minimum: 0 }),
});
export type HomeFeedbackResponse = Static<typeof HomeFeedbackResponseSchema>;

/** POST /v2/home/observations/:id：观察模式里一条「对 / 不对」。说对的次数够了，这一类放开成自动。 */
export const JudgeObservationRequestSchema = Type.Object(
  { requestId: RequestIdSchema, verdict: Type.Union([Type.Literal('right'), Type.Literal('wrong')]) },
  { additionalProperties: false },
);
export type JudgeObservationRequest = Static<typeof JudgeObservationRequestSchema>;
