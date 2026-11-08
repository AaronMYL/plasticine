// 对话里那张定时卡（《优化清单》第 3 条，设计稿 Plasticine-Schedule）：Plasticine 起草，他点确认才生效。
// 卡是线上的要你定卡（ask），这一份记在卡的 context.schedule 里，界面照它画。

import { Type, type Static } from 'typebox';
import { IdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const ScheduleCardPreviewSchema = Type.Object({
  scheduleId: IdSchema,
  title: Type.String(),
  /** 「每天 15:00」：按他所在地的时间。 */
  when: Type.String(),
  /** 照卡发给谁（以他名义对外的卡）；不对外的是 null。 */
  who: OrNull(Type.Array(Type.String())),
  /** 发什么 / 做什么。 */
  what: Type.String(),
  place: OrNull(Type.String()),
  /** 结果放哪。 */
  report: Type.String(),
  projectName: Type.String(),
  /** 以他名义发出：卡上常显后果。 */
  outward: Type.Boolean(),
  /** 改的是哪一张（改了要他再确认一次）。 */
  replaces: Type.Boolean(),
}, STRICT);
export type ScheduleCardPreview = Static<typeof ScheduleCardPreviewSchema>;

/**
 * 研究周报样刊出来时附的卡（第 7 批第 14 条，他定，设计稿 Chat-Sample）：「每周五 08:00 出一期」+ 订阅名，按钮「开启定时」
 * 「再改改」；带上那一期（站内链接打开）。
 */
export const SubscriptionCardPreviewSchema = Type.Object({
  subscriptionId: IdSchema,
  /** 订阅名。 */
  title: Type.String(),
  /** 「每周五 08:00 出一期」：按订阅设置拼，他所在地的时间。 */
  when: Type.String(),
  /** 样刊那一期（空间）和期号。 */
  spaceId: IdSchema,
  issueNumber: OrNull(Type.Integer({ minimum: 1 })),
}, STRICT);
export type SubscriptionCardPreview = Static<typeof SubscriptionCardPreviewSchema>;
