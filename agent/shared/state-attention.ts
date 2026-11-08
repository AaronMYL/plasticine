// 要你定卡（《UI 方案》第 6 节）和 Web Push 订阅（第 91 条 ⑤：「立刻打断」用浏览器系统通知）。attention/ 决定卡走哪一档
// 渠道、什么时候推送；state/ 只存取。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { ASK_BASES, type AskBasis } from './act-or-ask.ts';

export type { AskBasis } from './act-or-ask.ts';
import { IdSchema, IsoTimeSchema, Nullable, RECORD_META } from './state-common.ts';
import { CHANNELS } from './state-objects.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

/** 小签：要你定 · 要你确认 · 要你授权 · 要你动手（《UI 方案》第 6 节「卡的固定结构」）。 */
export const ASK_KINDS = ['decide', 'confirm', 'approve', 'act'] as const;
export const AskKindSchema = Type.Enum(ASK_KINDS);
export type AskKind = Static<typeof AskKindSchema>;

/**
 * 卡被答之后由谁接着做什么：money_confirmation 是记账截图要你确认；backup_restore 是恢复备份；device_action 是设备
 * 动作授权（devices/）；network_* 是网络那一头（network/）；line_* 是新内核的线（lines/）。
 */
export const ASK_PURPOSES = [
  'money_confirmation',
  'backup_restore',
  'device_action',
  // 第 113 条：别人发来的任务等你表态 / 验收 / 交付（network/tasks.ts）；分身拿不准、等你确认怎么回（network/proxy.ts）。
  'network_task',
  'network_reply',
  // 新内核（2026-11-05 Harness 重做）：线上的硬线工具要他点头（只放行这一次）；线上的 ask_user 问他一件事。
  'line_approval',
  'line_question',
] as const;
export const AskPurposeSchema = Type.Enum(ASK_PURPOSES);
export type AskPurpose = Static<typeof AskPurposeSchema>;

/** 出卡的依据（shared/act-or-ask.ts「做还是问」那条线，第 5 批）。上线前的旧卡是 null。 */
export const AskBasisSchema = Type.Enum(ASK_BASES);

/**
 * 现有的卡逐个归类（《置信度与做事方式改动方案》第 5 批）：
 * - hard_line 硬线，谁出都记硬线：设备动作授权；别人发来的任务；恢复备份；线上的硬线工具。
 * - by_confidence 看把握，出卡的人按那条线写依据，没写就用这里的默认：线上的 ask_user；替你回别人（有草稿是推出来的、
 *   没有是资料里没有）；记账看不清（资料里没有）、好像记过（几种可能）。
 * 2026-11-05 Harness 重做时，任务、验收、恢复、采访、关切触发、自迭代、改进、启用、认知、碰撞、发到 X、事情归属这些
 * 用途随功能删掉，旧卡在迁移 0062 删了。retired 这一档现在没有用途，留着是给以后退役的卡。
 * 「下次汇报」是渠道不是依据，那一档的卡按各自的用途归；后台规则开关是你点的开关，不出卡。
 */
export const ASK_LINES = ['retired', 'hard_line', 'by_confidence'] as const;
export type AskLine = (typeof ASK_LINES)[number];

export const ASK_PURPOSE_LINES: Readonly<Record<AskPurpose, { line: AskLine; basis: AskBasis }>> = {
  money_confirmation: { line: 'by_confidence', basis: 'missing' },
  backup_restore: { line: 'hard_line', basis: 'hard_line' },
  device_action: { line: 'hard_line', basis: 'hard_line' },
  network_task: { line: 'hard_line', basis: 'hard_line' },
  network_reply: { line: 'by_confidence', basis: 'missing' },
  line_approval: { line: 'hard_line', basis: 'hard_line' },
  line_question: { line: 'by_confidence', basis: 'missing' },
};

/** 四档渠道（《从零方案》第 6 节，关切上已有同一份 CHANNELS）：不打扰 · 下次汇报 · 弹框 · 立刻打断。 */
export const ChannelSchema = Type.Enum(CHANNELS);
export type Channel = Static<typeof ChannelSchema>;

/** 「先不」不是状态：卡仍是 open，只是收回清单（deferredAt 有值）。 */
export const ASK_STATUSES = ['open', 'answered', 'withdrawn'] as const;
export const AskStatusSchema = Type.Enum(ASK_STATUSES);
export type AskStatus = Static<typeof AskStatusSchema>;

// The card's one sentence is ≤ 40 characters in the UI (《UI 方案》第 6 节); cards the system writes itself quote a
// task title, so the store allows more and the request_input tool keeps the model to 40.
export const ASK_QUESTION_MAX_CHARS = 120;
export const ASK_DETAIL_MAX_CHARS = 4_000;
export const ASK_OPTION_MAX = 6;
export const AskOptionIdSchema = Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' });

export const AskOptionSchema = Type.Object(
  {
    id: AskOptionIdSchema,
    label: Type.String({ minLength: 1, maxLength: 30 }),
    recommended: Type.Boolean(),
    description: Nullable(Type.String({ maxLength: 200 })),
  },
  STRICT,
);
export type AskOption = Static<typeof AskOptionSchema>;

/** What the user chose: an option, free text, or both (text only when the card has no options). */
export const AskAnswerSchema = Type.Object(
  {
    optionId: Nullable(AskOptionIdSchema),
    label: Type.String(),
    text: Nullable(Type.String()),
  },
  STRICT,
);
export type AskAnswer = Static<typeof AskAnswerSchema>;

export const AskInputSchema = Type.Object(
  {
    kind: AskKindSchema,
    purpose: AskPurposeSchema,
    channel: ChannelSchema,
    question: Type.String({ minLength: 1, maxLength: ASK_QUESTION_MAX_CHARS }),
    detail: Type.Optional(Nullable(Type.String({ maxLength: ASK_DETAIL_MAX_CHARS }))),
    options: Type.Array(AskOptionSchema, { maxItems: ASK_OPTION_MAX }),
    taskId: Type.Optional(Nullable(IdSchema)),
    runId: Type.Optional(Nullable(IdSchema)),
    // The action that raised the card (a tool call's action id): raising it again returns the same card.
    actionId: Type.Optional(Nullable(IdSchema)),
    // Purpose-specific data, e.g. the receipt an unknown_result card is about.
    context: Type.Optional(Nullable(Type.Record(Type.String(), Type.Unknown()))),
    // 迁移 0057：为什么问（第 5 批）。attention/asks.ts 出卡时按 ASK_PURPOSE_LINES 补齐，所以新卡都有。
    basis: Type.Optional(Nullable(AskBasisSchema)),
  },
  STRICT,
);
export type AskInput = Static<typeof AskInputSchema>;

export const AskPatchSchema = Type.Partial(
  Type.Object({
    status: AskStatusSchema,
    answer: Nullable(AskAnswerSchema),
    answeredAt: Nullable(IsoTimeSchema),
    answeredByDeviceId: Nullable(IdSchema),
    deferredAt: Nullable(IsoTimeSchema),
    withdrawnAt: Nullable(IsoTimeSchema),
    feedback: Nullable(Type.Enum(['appropriate', 'unnecessary'])),
    feedbackAt: Nullable(IsoTimeSchema),
    // System dispositions retain their own source; they never populate the user's answer or signature fields.
    context: Nullable(Type.Record(Type.String(), Type.Unknown())),
  }),
  STRICT,
);
export type AskPatch = Static<typeof AskPatchSchema>;

export const AskSchema = Type.Object({
  ...RECORD_META,
  ...Type.Required(AskInputSchema).properties,
  status: AskStatusSchema,
  answer: Nullable(AskAnswerSchema),
  answeredAt: Nullable(IsoTimeSchema),
  answeredByDeviceId: Nullable(IdSchema),
  deferredAt: Nullable(IsoTimeSchema),
  withdrawnAt: Nullable(IsoTimeSchema),
  feedback: Nullable(Type.Enum(['appropriate', 'unnecessary'])),
  feedbackAt: Nullable(IsoTimeSchema),
});
export type Ask = Static<typeof AskSchema>;

/** The keys a browser's PushSubscription carries (RFC 8291): the P-256 public key and the 16-byte auth secret. */
export const PushKeysSchema = Type.Object(
  {
    p256dh: Type.String({ pattern: '^[A-Za-z0-9_-]{80,100}$' }),
    auth: Type.String({ pattern: '^[A-Za-z0-9_-]{16,32}$' }),
  },
  STRICT,
);
export type PushKeys = Static<typeof PushKeysSchema>;

// Push services hand out https URLs of a few hundred characters; 2 048 leaves room and keeps the index small.
export const PUSH_ENDPOINT_MAX_CHARS = 2_048;
export const PushEndpointSchema = Type.String({ pattern: '^https://', maxLength: PUSH_ENDPOINT_MAX_CHARS });

export const PushSubscriptionInputSchema = Type.Object(
  { deviceId: IdSchema, endpoint: PushEndpointSchema, ...PushKeysSchema.properties },
  STRICT,
);
export type PushSubscriptionInput = Static<typeof PushSubscriptionInputSchema>;
export const PushSubscriptionPatchSchema = Type.Partial(
  Type.Object({
    deviceId: IdSchema,
    p256dh: PushKeysSchema.properties.p256dh,
    auth: PushKeysSchema.properties.auth,
    revokedAt: Nullable(IsoTimeSchema),
    lastSentAt: Nullable(IsoTimeSchema),
    lastError: Nullable(Text),
    generation: Type.Integer({ minimum: 1 }),
  }),
  STRICT,
);
export type PushSubscriptionPatch = Static<typeof PushSubscriptionPatchSchema>;
export const PushSubscriptionSchema = Type.Object({
  ...RECORD_META,
  ...PushSubscriptionInputSchema.properties,
  revokedAt: Nullable(IsoTimeSchema),
  lastSentAt: Nullable(IsoTimeSchema),
  lastError: Nullable(Type.String()),
  // 迁移 0007：只在重新订阅、退订时加一；推送结果按发送时的代次写，旧订阅的回应不碰新订阅。
  generation: Type.Integer({ minimum: 1 }),
});
export type PushSubscription =Static<typeof PushSubscriptionSchema>;

// ---------- 邮件兜底的开关（用户 2026-11-01 定：只给「订阅需要重新登录」「任务连续失败」两类卡加邮件） ----------

/** 一行；没有行时算开着（默认开，用户可关）。发不发、发什么由 attention/mail-fallback.ts 决定，这里只存开关。 */
export const MailFallbackSettingsSchema = Type.Object({
  ...RECORD_META,
  enabled: Type.Boolean(),
});
export type MailFallbackSettings = Static<typeof MailFallbackSettingsSchema>;
