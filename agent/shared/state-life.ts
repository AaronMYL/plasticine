// SPDX-License-Identifier: Apache-2.0
// M5 日常事务的共同状态（《实施方案》第 4 节 money_* · focus_* · reminders，第 2 节「JSON 文件：记账、专注…进表」）：
// 记账（分类、账户、一笔一笔）、专注（一段一段，含心跳）、提醒、交互遥测的开关。金额一律整数分（plasticine-code
// 「金额用整数分」），币种另记；非人民币按当时的汇率折成人民币分另存一列，没有汇率就按原币计（1ca0391 money.ts）。
// state/ 只存取；月汇总、统计、余额怎么算在 life/。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable, OBJECT_META, RECORD_META } from './state-common.ts';

const STRICT = { additionalProperties: false };

// ---------- 记账 ----------

export const MONEY_ENTRY_KINDS = ['expense', 'income', 'transfer', 'refund'] as const;
export const MONEY_ACCOUNT_TYPES = ['wallet', 'debit', 'credit', 'cash', 'other'] as const;
export const MONEY_CATEGORY_KINDS = ['expense', 'income'] as const;
/** manual 手记 · shortcut 快捷指令 · ai 截图识别 · import 迁移 · brain 它在对话里记的。 */
export const MONEY_ORIGINS = ['manual', 'shortcut', 'ai', 'import', 'brain'] as const;
// 1ca0391 money.ts：一笔最多 10 亿元，存成分。
export const MONEY_AMOUNT_MAX_CENTS = 100_000_000_000;
export const MONEY_NOTE_MAX_CHARS = 200;
export const MONEY_MERCHANT_MAX_CHARS = 60;

/**
 * 1ca0391 money.ts 的默认分类（旧版放在代码里，没写进 categories.json；新版第一次用时建成行，迁移也按它补）。图标和颜色
 * 不带：方向 I 不按类别上色。
 */
export const MONEY_DEFAULT_CATEGORIES: readonly { id: string; name: string; kind: 'expense' | 'income' }[] = [
  { id: 'food', name: '餐饮', kind: 'expense' },
  { id: 'shop', name: '购物', kind: 'expense' },
  { id: 'house', name: '住房', kind: 'expense' },
  { id: 'traffic', name: '交通', kind: 'expense' },
  { id: 'fun', name: '娱乐', kind: 'expense' },
  { id: 'travel', name: '旅行', kind: 'expense' },
  { id: 'study', name: '学习', kind: 'expense' },
  { id: 'office', name: '办公', kind: 'expense' },
  { id: 'smoke', name: '香烟', kind: 'expense' },
  { id: 'daily', name: '日用', kind: 'expense' },
  { id: 'phone', name: '通讯', kind: 'expense' },
  { id: 'health', name: '医疗', kind: 'expense' },
  { id: 'gift', name: '人情', kind: 'expense' },
  { id: 'other', name: '其他', kind: 'expense' },
  { id: 'salary', name: '工资', kind: 'income' },
  { id: 'bonus', name: '奖金', kind: 'income' },
  { id: 'reimburse', name: '报销', kind: 'income' },
  { id: 'income-other', name: '其他收入', kind: 'income' },
];

export const CentsSchema = Type.Integer({ minimum: 1, maximum: MONEY_AMOUNT_MAX_CENTS });
/** 期初余额可以是负的（信用卡欠款）。 */
export const SignedCentsSchema = Type.Integer({ minimum: -MONEY_AMOUNT_MAX_CENTS, maximum: MONEY_AMOUNT_MAX_CENTS });
export const CurrencySchema = Type.String({ pattern: '^[A-Z]{3}$' });

export const MoneyCategoryInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 20 }),
    kind: Type.Enum(MONEY_CATEGORY_KINDS),
    sortOrder: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type MoneyCategoryInput = Static<typeof MoneyCategoryInputSchema>;
export const MoneyCategoryPatchSchema = Type.Partial(
  Type.Object({ name: MoneyCategoryInputSchema.properties.name, sortOrder: Type.Integer({ minimum: 0 }) }),
  STRICT,
);
export const MoneyCategorySchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(MoneyCategoryInputSchema).properties,
});
export type MoneyCategory = Static<typeof MoneyCategorySchema>;

export const MoneyAccountInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 30 }),
    type: Type.Enum(MONEY_ACCOUNT_TYPES),
    openingCents: SignedCentsSchema,
    // 「不计入」：余额照算，不进资产 / 负债的总数。
    excluded: Type.Optional(Type.Boolean()),
    note: Type.Optional(Nullable(Type.String({ maxLength: 60 }))),
    sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  STRICT,
);
export type MoneyAccountInput = Static<typeof MoneyAccountInputSchema>;
export const MoneyAccountPatchSchema = Type.Partial(
  Type.Object({
    name: MoneyAccountInputSchema.properties.name,
    type: Type.Enum(MONEY_ACCOUNT_TYPES),
    openingCents: SignedCentsSchema,
    excluded: Type.Boolean(),
    note: Nullable(Type.String({ maxLength: 60 })),
    sortOrder: Type.Integer({ minimum: 0 }),
    // 停用的账户不删，只是不再列出来。
    archivedAt: Nullable(IsoTimeSchema),
  }),
  STRICT,
);
export type MoneyAccountPatch = Static<typeof MoneyAccountPatchSchema>;
export const MoneyAccountSchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(MoneyAccountInputSchema).properties,
  archivedAt: Nullable(IsoTimeSchema),
});
export type MoneyAccount = Static<typeof MoneyAccountSchema>;

const MoneyEntryFields = {
  kind: Type.Enum(MONEY_ENTRY_KINDS),
  amountCents: CentsSchema,
  currency: CurrencySchema,
  // 折成人民币的分；人民币就等于 amountCents。
  cnyCents: Type.Integer({ minimum: 0, maximum: MONEY_AMOUNT_MAX_CENTS * 100 }),
  categoryId: Nullable(IdSchema),
  accountId: Nullable(IdSchema),
  toAccountId: Nullable(IdSchema),
  merchant: Nullable(Type.String({ maxLength: MONEY_MERCHANT_MAX_CHARS })),
  note: Nullable(Type.String({ maxLength: MONEY_NOTE_MAX_CHARS })),
  occurredAt: IsoTimeSchema,
  discountCents: Nullable(CentsSchema),
  feeCents: Nullable(CentsSchema),
  confidence: Nullable(Type.Number({ minimum: 0, maximum: 1 })),
  // 「待你看一眼」：截图识别拿不准的先记下、标出来。
  review: Type.Boolean(),
};
export const MoneyEntryInputSchema = Type.Object(
  { ...MoneyEntryFields, origin: Type.Enum(MONEY_ORIGINS) },
  STRICT,
);
export type MoneyEntryInput = Static<typeof MoneyEntryInputSchema>;
export const MoneyEntryPatchSchema = Type.Partial(
  Type.Object({ ...MoneyEntryFields, deletedAt: Nullable(IsoTimeSchema) }),
  STRICT,
);
export type MoneyEntryPatch = Static<typeof MoneyEntryPatchSchema>;
export const MoneyEntrySchema = Type.Object({
  ...OBJECT_META,
  ...MoneyEntryInputSchema.properties,
  // 删一笔只打时间（不删任何现有数据）。
  deletedAt: Nullable(IsoTimeSchema),
});
export type MoneyEntry = Static<typeof MoneyEntrySchema>;

// ---------- 专注 ----------

export const FOCUS_STATUSES = ['running', 'done', 'stopped'] as const;
// 1ca0391 focus.ts：一段 5–180 分钟，默认 25。
export const FOCUS_MINUTES_MIN = 5;
export const FOCUS_MINUTES_MAX = 180;
export const FOCUS_MINUTES_DEFAULT = 25;
export const FocusSessionInputSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 80 }),
    minutes: Type.Integer({ minimum: FOCUS_MINUTES_MIN, maximum: FOCUS_MINUTES_MAX }),
    startedAt: IsoTimeSchema,
    endsAt: IsoTimeSchema,
    // 从一条判断开始计时（旧版的 propositionId）。
    judgmentId: Type.Optional(Nullable(IdSchema)),
    deviceId: Type.Optional(Nullable(IdSchema)),
    status: Type.Optional(Type.Enum(FOCUS_STATUSES)),
  },
  STRICT,
);
export type FocusSessionInput = Static<typeof FocusSessionInputSchema>;
export const FocusSessionPatchSchema = Type.Partial(
  Type.Object({
    status: Type.Enum(FOCUS_STATUSES),
    endedAt: Nullable(IsoTimeSchema),
    actualMinutes: Nullable(Type.Integer({ minimum: 0, maximum: FOCUS_MINUTES_MAX })),
    lastHeartbeatAt: Nullable(IsoTimeSchema),
    heartbeatDeviceId: Nullable(IdSchema),
  }),
  STRICT,
);
export type FocusSessionPatch = Static<typeof FocusSessionPatchSchema>;
export const FocusSessionSchema = Type.Object({
  ...OBJECT_META,
  ...Type.Required(FocusSessionInputSchema).properties,
  ...Type.Required(FocusSessionPatchSchema).properties,
});
export type FocusSession = Static<typeof FocusSessionSchema>;

// ---------- 提醒 ----------

export const REMINDER_ORIGINS = ['user', 'brain', 'import'] as const;
export const REMINDER_SUBJECT_MAX_CHARS = 120;
export const REMINDER_BODY_MAX_CHARS = 4_000;
export const ReminderInputSchema = Type.Object(
  {
    subject: Type.String({ minLength: 1, maxLength: REMINDER_SUBJECT_MAX_CHARS }),
    body: Type.String({ maxLength: REMINDER_BODY_MAX_CHARS }),
    dueAt: IsoTimeSchema,
    origin: Type.Enum(REMINDER_ORIGINS),
  },
  STRICT,
);
export type ReminderInput = Static<typeof ReminderInputSchema>;
export const ReminderPatchSchema = Type.Partial(
  Type.Object({ firedAt: Nullable(IsoTimeSchema), deletedAt: Nullable(IsoTimeSchema) }),
  STRICT,
);
export const ReminderSchema = Type.Object({
  ...OBJECT_META,
  ...ReminderInputSchema.properties,
  firedAt: Nullable(IsoTimeSchema),
  deletedAt: Nullable(IsoTimeSchema),
});
export type Reminder = Static<typeof ReminderSchema>;

// ---------- 交互遥测的开关（《UI 方案》第 13 节：采集由开关控制，用户可关） ----------

export const TelemetrySettingsSchema = Type.Object({
  ...RECORD_META,
  enabled: Type.Boolean(),
});
export type TelemetrySettings = Static<typeof TelemetrySettingsSchema>;
