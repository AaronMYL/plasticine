// /v2/backstage：常驻项目 Plasticine 的后台（2026-11-04 第 2 批，用户定「Plasticine 自己的后台活动单独一处，要他定才上
// 首页；放在常驻项目 Plasticine 的项目页」）。三节，空节界面整节不显示（2026-11-05 任务删了，原来的「停下的」「在做」两节没了：规则开的后台线在线列表里）：
//   schedules  定时：服务端自己按钟点跑的几样（本机备份、抓信息流），写下次时间和上一次的出错。
//   rules      规则：每条一个开关（开 = 自动档，关 = 关档）。开关走 POST /v2/backstage/rules/:code，记成你在设备上改的
//              （rule_events actor user，原因写设备）；和长期维护入口一样只改档位、留事件，不改规则文字、不删。
//   notices    通知信：Plasticine 自己发给他的通知（shared/plasticine-notice.ts），新的在前；全文按站内信接口读。

import { Type, type Static } from 'typebox';
import { RULE_MODES } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';
export { isPlasticineNotice, PLASTICINE_NOTICE_SOURCE } from '../plasticine-notice.ts';

export const BACKSTAGE_PATH = `${API_PREFIX}/backstage`;
export const BACKSTAGE_RULES_PATH = `${BACKSTAGE_PATH}/rules`;

/** 通知信列最近这么多封（全部在设置 · 通知记录里）。 */
export const BACKSTAGE_NOTICES_MAX = 20;

export const BackstageQuerySchema = Type.Object(
  { tz: Type.Optional(TimeZoneSchema) },
  { additionalProperties: false },
);
export type BackstageQuery = Static<typeof BackstageQuerySchema>;

/** 服务端自己按钟点跑的几样（app/system-schedules.ts）。 */
export const SYSTEM_SCHEDULE_IDS = ['backup', 'feed'] as const;
export const SYSTEM_SCHEDULE_EVERY = ['daily', 'weekly'] as const;

export const BackstageScheduleSchema = Type.Object({
  id: Type.Enum(SYSTEM_SCHEDULE_IDS),
  title: Type.String({ minLength: 1 }),
  every: Type.Enum(SYSTEM_SCHEDULE_EVERY),
  /** 下一次的时间；界面按 timeZone 写成「每天 07:00」「周日 21:00」。 */
  nextAt: IsoTimeSchema,
  timeZone: TimeZoneSchema,
  /** 上一次没成的那句原因；成了或还没跑过是 null。 */
  lastError: OrNull(Type.String()),
});
export type BackstageSchedule = Static<typeof BackstageScheduleSchema>;

export const BackstageRuleSchema = Type.Object({
  id: IdSchema,
  code: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  /** 规则全文（浮框说明用）。 */
  text: Type.String(),
  mode: Type.Enum(RULE_MODES),
  /** 开关：自动档是开；关档和观察档（只记不做）都是关。 */
  on: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type BackstageRule = Static<typeof BackstageRuleSchema>;

export const BackstageNoticeSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  at: IsoTimeSchema,
  read: Type.Boolean(),
});
export type BackstageNotice = Static<typeof BackstageNoticeSchema>;

export const BackstageResponseSchema = Type.Object({
  schedules: Type.Array(BackstageScheduleSchema),
  rules: Type.Array(BackstageRuleSchema),
  notices: Type.Array(BackstageNoticeSchema, { maxItems: BACKSTAGE_NOTICES_MAX }),
  timeZone: TimeZoneSchema,
});
export type BackstageResponse = Static<typeof BackstageResponseSchema>;

/** POST /v2/backstage/rules/:code：开 = 自动档，关 = 关档。version 是画开关时那一版，旧了 409。按 requestId 幂等。 */
export const SetBackstageRuleRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), on: Type.Boolean() },
  { additionalProperties: false },
);
export type SetBackstageRuleRequest = Static<typeof SetBackstageRuleRequestSchema>;

export const SetBackstageRuleResponseSchema = Type.Object({ rule: BackstageRuleSchema });
export type SetBackstageRuleResponse = Static<typeof SetBackstageRuleResponseSchema>;
