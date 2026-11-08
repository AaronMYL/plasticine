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
