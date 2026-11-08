// 心跳（《优化清单》第 11 条，11-06 定；设计稿 Tasks-Heartbeat）：「定时」里点开心跳那一行的右侧弹层——多久一次、
// 安静时段、模型（用途 heartbeat，模型设置走 /v2/model-providers）、看什么（清单：能拖、能删、能用一句话改）、最近几次。
// 清单在库里（timed_slots 的 heartbeat 那一行），更新不碰；他也能在对话里跟 Plasticine 说一句让它改。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const HEARTBEAT_PATH = `${API_PREFIX}/heartbeat`;
export const HEARTBEAT_SAY_PATH = `${HEARTBEAT_PATH}/say`;

/** 每条看什么由代码先筛：邮件、日历、等你、后台结果、朋友、到期、信息流；他自己加的（custom）交给模型一起看。 */
export const HEARTBEAT_ITEM_KINDS = [
  'mail', 'calendar', 'waiting', 'results', 'friends', 'due', 'feed', 'custom',
] as const;
export type HeartbeatItemKind = (typeof HEARTBEAT_ITEM_KINDS)[number];
/** 清单要短（他 11-06：「读一张很短的清单」）。 */
export const HEARTBEAT_ITEMS_MAX = 12;
export const HEARTBEAT_ITEM_MAX_CHARS = 60;
/** 多久一次能选的几档；默认 30 分钟（参考 OpenClaw 的 Heartbeat）。 */
export const HEARTBEAT_INTERVALS = [15, 30, 60, 120] as const;
export const HEARTBEAT_RECENT = 5;

const Clock = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });

export const HeartbeatItemSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40 }),
  kind: Type.Enum(HEARTBEAT_ITEM_KINDS),
  text: Type.String({ minLength: 1, maxLength: HEARTBEAT_ITEM_MAX_CHARS }),
}, STRICT);
export type HeartbeatItem = Static<typeof HeartbeatItemSchema>;

export const HeartbeatConfigSchema = Type.Object({
  intervalMinutes: Type.Union([Type.Literal(15), Type.Literal(30), Type.Literal(60), Type.Literal(120)]),
  /** 安静时段：这段时间不跳（按他所在地的时区）。 */
  quietFrom: Clock,
  quietTo: Clock,
  items: Type.Array(HeartbeatItemSchema, { maxItems: HEARTBEAT_ITEMS_MAX }),
}, STRICT);
export type HeartbeatConfig = Static<typeof HeartbeatConfigSchema>;

export const HeartbeatBeatViewSchema = Type.Object({
  at: IsoTimeSchema,
  /** 「「评审会」邀请要回复 → 发了消息给你」「没事」。 */
  note: Type.String(),
  failed: Type.Boolean(),
}, STRICT);
export type HeartbeatBeatView = Static<typeof HeartbeatBeatViewSchema>;

/** GET /v2/heartbeat */
export const HeartbeatViewSchema = Type.Object({
  enabled: Type.Boolean(),
  config: HeartbeatConfigSchema,
  nextAt: OrNull(IsoTimeSchema),
  /** 最近几次（新的在前）：叫了模型的那几次，加上最近一次「看过，没事」。 */
  recent: Type.Array(HeartbeatBeatViewSchema),
}, STRICT);
export type HeartbeatView = Static<typeof HeartbeatViewSchema>;

/** PUT /v2/heartbeat：改多久一次、清单（整份：顺序就是拖过的顺序，删掉的不在里面，新加的 id 由服务端给）。 */
export const UpdateHeartbeatRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  intervalMinutes: Type.Optional(HeartbeatConfigSchema.properties.intervalMinutes),
  items: Type.Optional(Type.Array(Type.Object({
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    text: Type.String({ minLength: 1, maxLength: HEARTBEAT_ITEM_MAX_CHARS }),
  }, STRICT), { maxItems: HEARTBEAT_ITEMS_MAX })),
}, STRICT);
export type UpdateHeartbeatRequest = Static<typeof UpdateHeartbeatRequestSchema>;

/** POST /v2/heartbeat/say：一句话改清单（「别再看信息流了」「也看看快递」）。 */
export const HeartbeatSayRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  text: Type.String({ minLength: 1, maxLength: 300 }),
}, STRICT);
export type HeartbeatSayRequest = Static<typeof HeartbeatSayRequestSchema>;
