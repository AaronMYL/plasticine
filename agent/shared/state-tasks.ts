// 任务栏目（《优化清单》第 3、4、5 条，用户 11-06 定，11-07 补）存在库里的三样：定时线、照卡发送的记录、建议。
// - 定时线（schedules）：到点替他做一件事（每晚同步抖音收藏、每周检查某个网站）。Plasticine 起草一张定时卡，他点确认才生效；
//   每次到点往这条定时线（一条后台线）里放一条消息，和别的后台线一样排队、受并发上限。
// - 照卡发送（schedule_sends）：以他名义、对象和内容固定的定时发送（每天 15:00 给 8 位好友各发一个表情续火花）。建任务时
//   他确认一次，以后每天照卡做；每次照卡发送记下是哪张卡、哪次确认（可审计），硬线放行只认这里的记录。
// - 建议（suggestions）：Plasticine 主动想到能帮他的事。推测不算他的决定，他点了「开始做」「加成待办」才算。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const SCHEDULE_TITLE_MAX_CHARS = 60;
export const SCHEDULE_GOAL_MAX_CHARS = 4_000;
/** 卡上一行写得下：「每人一个表情，每天随机换」「只在有人发不出去时告诉你」。 */
export const SCHEDULE_LABEL_MAX_CHARS = 80;
/** 照卡发送最多发给这么多人：一张卡要他一眼看得完。 */
export const SCHEDULE_RECIPIENTS_MAX = 30;
export const SCHEDULE_RECIPIENT_MAX_CHARS = 40;
/** 定的固定内容：一条最多这么长，最多这么几条（每次从里面挑）。 */
export const SCHEDULE_FIXED_TEXT_MAX_CHARS = 200;
export const SCHEDULE_FIXED_TEXTS_MAX = 10;
/** 「每 N 分钟」最短 15 分钟：再密就不是「定时替他做的事」了，是盯着。 */
export const SCHEDULE_INTERVAL_MIN_MINUTES = 15;
export const SCHEDULE_INTERVAL_MAX_MINUTES = 24 * 60;

/** 钟点：按他设备当前的时区解释（11-07 定：出差换地方，到点时间跟着变）。 */
export const ClockSchema = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });

/** 多久一次：每天几点、每周哪几天几点（1 = 周一 … 7 = 周日）、每隔多少分钟。 */
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

/**
 * 照卡发送的内容规则：机器核得了的才算「内容固定」。emoji 只发表情（不带一个字）；fixed 只发这几条里的一条（原样）。
 */
export const ScheduleContentRuleSchema = Type.Union([
  Type.Object({ kind: Type.Literal('emoji') }, STRICT),
  Type.Object({
    kind: Type.Literal('fixed'),
    texts: Type.Array(Type.String({ minLength: 1, maxLength: SCHEDULE_FIXED_TEXT_MAX_CHARS }),
      { minItems: 1, maxItems: SCHEDULE_FIXED_TEXTS_MAX }),
  }, STRICT),
]);
export type ScheduleContentRule = Static<typeof ScheduleContentRuleSchema>;

/** 以他名义对外发出的范围：在哪发（网站）、对谁、发什么。超出这张卡的，照旧先问他。 */
export const ScheduleOutwardSchema = Type.Object({
  /** 卡上写的地方：「抖音私信」。 */
  channel: Type.String({ minLength: 1, maxLength: 30 }),
  /** 只在这个网站上发（主机名，douyin.com 也认 www.douyin.com）。 */
  site: Type.String({ minLength: 3, maxLength: 100, pattern: '^[a-z0-9.-]+$' }),
  recipients: Type.Array(Type.String({ minLength: 1, maxLength: SCHEDULE_RECIPIENT_MAX_CHARS }),
    { minItems: 1, maxItems: SCHEDULE_RECIPIENTS_MAX, uniqueItems: true }),
  content: ScheduleContentRuleSchema,
  /** 卡上「发什么」那一行：「每人一个表情，每天随机换」。 */
  contentLabel: Type.String({ minLength: 1, maxLength: SCHEDULE_LABEL_MAX_CHARS }),
}, STRICT);
export type ScheduleOutward = Static<typeof ScheduleOutwardSchema>;

/** 结果放哪：每次都贴回主线；只在没做成时告诉他。 */
export const SCHEDULE_REPORTS = ['always', 'failures'] as const;
export type ScheduleReport = (typeof SCHEDULE_REPORTS)[number];

/**
 * draft 起草了、等他确认；active 在跑；paused 他（或他让 Plasticine）停了；declined 他没确认；replaced 改过，换成了新的
 * 一张；removed 删了（只标记，行留着：照卡发送的记录要能对回这张卡）。
 */
export const SCHEDULE_STATUSES = ['draft', 'active', 'paused', 'declined', 'replaced', 'removed'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** 上一次的结果：做成；没做成（线自己说的原因）；出错；叫停了。 */
export const SCHEDULE_OUTCOMES = ['done', 'unmet', 'failed', 'stopped'] as const;
export type ScheduleOutcome = (typeof SCHEDULE_OUTCOMES)[number];

export const ScheduleInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SCHEDULE_TITLE_MAX_CHARS }),
  /** 每次到点放进定时线的那段话：要做什么、做到什么算完。 */
  goal: Type.String({ minLength: 1, maxLength: SCHEDULE_GOAL_MAX_CHARS }),
  cadence: ScheduleCadenceSchema,
  projectId: IdSchema,
  report: Type.Enum(SCHEDULE_REPORTS),
  /** 卡上「在哪做」：「你的 Mac」。不用某台设备的是 null。 */
  place: Nullable(Type.String({ minLength: 1, maxLength: SCHEDULE_LABEL_MAX_CHARS })),
  outward: Nullable(ScheduleOutwardSchema),
  /** 这张是改哪一张（改了要他再确认一次）；新建是 null。 */
  replacesId: Nullable(IdSchema),
  /** 起草它的那条线和那次调用（同一次调用重跑认回同一张）。 */
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
  /** 这张卡的定时线：第一次到点才开。 */
  lineId: Nullable(IdSchema),
  nextAt: Nullable(IsoTimeSchema),
  /** 上一次放进线里的那个到点时刻。 */
  lastRunAt: Nullable(IsoTimeSchema),
  lastOutcome: Nullable(Type.Enum(SCHEDULE_OUTCOMES)),
  lastNote: Nullable(Type.String()),
  /** 他确认的那张卡、哪台设备、什么时候（照卡发送对回这里）。 */
  confirmAskId: Nullable(IdSchema),
  confirmedAt: Nullable(IsoTimeSchema),
  confirmedByDeviceId: Nullable(IdSchema),
  removedAt: Nullable(IsoTimeSchema),
});
export type Schedule = Static<typeof ScheduleSchema>;

/** 一次照卡发送的放行：哪张卡、哪次确认、哪一次到点、发给谁、发了什么、在哪个标签的哪一下。只增不改。 */
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
/** 谁提的：主对话里的 Plasticine，以后还有回顾、心跳、做梦。 */
export const SUGGESTION_SOURCES = ['plasticine', 'review', 'heartbeat', 'dream'] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];
/** 卡前那个图标块：文档、研究、邮件、书、定时、别的。 */
export const SUGGESTION_ICONS = ['file', 'space', 'mail', 'books', 'clock', 'sparkle'] as const;
export type SuggestionIcon = (typeof SUGGESTION_ICONS)[number];
/** open 摆着；started 他点了开始做；todo 他加成了待办；dismissed 他忽略了。 */
export const SUGGESTION_STATUSES = ['open', 'started', 'todo', 'dismissed'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SuggestionInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SUGGESTION_TITLE_MAX_CHARS }),
  /** 为什么现在做：一句。 */
  why: Type.String({ minLength: 1, maxLength: SUGGESTION_WHY_MAX_CHARS }),
  /** 他点「开始做」时交给后台线的那段话。 */
  goal: Type.String({ minLength: 1, maxLength: SCHEDULE_GOAL_MAX_CHARS }),
  projectId: Nullable(IdSchema),
  source: Type.Enum(SUGGESTION_SOURCES),
  icon: Type.Enum(SUGGESTION_ICONS),
  /** 同一件事不重复提：同一个 key 还摆着（或他刚处理过）就不再出一张。 */
  key: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  /** 想到它的那一处（line:<线>:<条>）。 */
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
  /** 他点的那一下：什么时候、哪台设备（他点了才算他的决定）。 */
  actedAt: Nullable(IsoTimeSchema),
  actedByDeviceId: Nullable(IdSchema),
});
export type Suggestion = Static<typeof SuggestionSchema>;
