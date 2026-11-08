// /v2/money: 记账页（《UI 方案》第 9 节工具组；账本 / 资产 / 统计三页照 1ca0391 MoneyPage）。金额一律整数分，币种另记；
// 非人民币的给汇率（1 单位外币换多少元），服务端折成人民币分，客户端不填人民币那一列。删一笔只打时间。写操作按 requestId
// 幂等，带 version 的过时了 409 带现在那一条（current）。

import { Type, type Static } from 'typebox';
import {
  CentsSchema,
  CurrencySchema,
  MONEY_ACCOUNT_TYPES,
  MONEY_CATEGORY_KINDS,
  MONEY_ENTRY_KINDS,
  MONEY_MERCHANT_MAX_CHARS,
  MONEY_NOTE_MAX_CHARS,
  MONEY_ORIGINS,
  SignedCentsSchema,
} from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const MONEY_PATH = `${API_PREFIX}/money`;
export const MONEY_STATS_PATH = `${MONEY_PATH}/stats`;
export const MONEY_ENTRIES_PATH = `${MONEY_PATH}/entries`;
export const MONEY_ACCOUNTS_PATH = `${MONEY_PATH}/accounts`;
export const MONEY_STAT_RANGES = ['week', 'month', 'year'] as const;

const STRICT = { additionalProperties: false };
const MonthSchema = Type.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' });
const DaySchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const TimeZoneSchema = Type.String({ minLength: 1, maxLength: 64 });
const RateSchema = Type.Number({ exclusiveMinimum: 0, maximum: 10_000 });
const Merchant = Type.String({ maxLength: MONEY_MERCHANT_MAX_CHARS });
const Note = Type.String({ maxLength: MONEY_NOTE_MAX_CHARS });

export const MoneyEntryViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(MONEY_ENTRY_KINDS),
  amountCents: Type.Integer({ minimum: 1 }),
  currency: Type.String(),
  cnyCents: Type.Integer({ minimum: 0 }),
  categoryId: OrNull(IdSchema),
  categoryName: OrNull(Type.String()),
  accountId: OrNull(IdSchema),
  toAccountId: OrNull(IdSchema),
  merchant: OrNull(Type.String()),
  note: OrNull(Type.String()),
  occurredAt: IsoTimeSchema,
  discountCents: OrNull(Type.Integer({ minimum: 1 })),
  feeCents: OrNull(Type.Integer({ minimum: 1 })),
  origin: Type.Enum(MONEY_ORIGINS),
  confidence: OrNull(Type.Number({ minimum: 0, maximum: 1 })),
  review: Type.Boolean(),
  deleted: Type.Boolean(),
  migrated: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type MoneyEntryView = Static<typeof MoneyEntryViewSchema>;

export const MoneyCategoryViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  kind: Type.Enum(MONEY_CATEGORY_KINDS),
});
export type MoneyCategoryView = Static<typeof MoneyCategoryViewSchema>;

export const MoneyAccountViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  type: Type.Enum(MONEY_ACCOUNT_TYPES),
  openingCents: Type.Integer(),
  excluded: Type.Boolean(),
  note: OrNull(Type.String()),
  balanceCents: Type.Integer(),
  version: Type.Integer({ minimum: 1 }),
});
export type MoneyAccountView = Static<typeof MoneyAccountViewSchema>;

export const MoneyDayViewSchema = Type.Object({
  date: DaySchema,
  expenseCents: Type.Integer(),
  incomeCents: Type.Integer(),
  entries: Type.Array(MoneyEntryViewSchema),
});
export type MoneyDayView = Static<typeof MoneyDayViewSchema>;

/** GET /v2/money?month=YYYY-MM&tz= — 账本（这个月按天）、分类、账户和资产。 */
export const MoneyQuerySchema = Type.Object({ month: MonthSchema, tz: Type.Optional(TimeZoneSchema) }, STRICT);
export type MoneyQuery = Static<typeof MoneyQuerySchema>;
export const MoneyResponseSchema = Type.Object({
  month: MonthSchema,
  expenseCents: Type.Integer(),
  incomeCents: Type.Integer(),
  balanceCents: Type.Integer(),
  /** 「待你看一眼」的笔数（这个月）。 */
  review: Type.Integer({ minimum: 0 }),
  days: Type.Array(MoneyDayViewSchema),
  categories: Type.Array(MoneyCategoryViewSchema),
  accounts: Type.Array(MoneyAccountViewSchema),
  assetsCents: Type.Integer(),
  debtsCents: Type.Integer(),
  netCents: Type.Integer(),
});
export type MoneyResponse = Static<typeof MoneyResponseSchema>;

/** GET /v2/money/stats?range=week|month|year&anchor=YYYY-MM-DD&tz= */
export const MoneyStatsQuerySchema = Type.Object(
  { range: Type.Enum(MONEY_STAT_RANGES), anchor: DaySchema, tz: Type.Optional(TimeZoneSchema) },
  STRICT,
);
export type MoneyStatsQuery = Static<typeof MoneyStatsQuerySchema>;
export const MoneyStatsResponseSchema = Type.Object({
  range: Type.Enum(MONEY_STAT_RANGES),
  from: DaySchema,
  to: DaySchema,
  expenseCents: Type.Integer(),
  incomeCents: Type.Integer(),
  balanceCents: Type.Integer(),
  refundCents: Type.Integer(),
  discountCents: Type.Integer(),
  feeCents: Type.Integer(),
  monthlyAverageCents: Type.Integer(),
  count: Type.Integer({ minimum: 0 }),
  byCategory: Type.Array(
    Type.Object({
      categoryId: IdSchema,
      name: Type.String(),
      amountCents: Type.Integer(),
      share: Type.Number({ minimum: 0, maximum: 1 }),
    }),
  ),
});
export type MoneyStatsResponse = Static<typeof MoneyStatsResponseSchema>;

const EntryFields = {
  kind: Type.Enum(MONEY_ENTRY_KINDS),
  amountCents: CentsSchema,
  currency: CurrencySchema,
  rate: OrNull(RateSchema),
  categoryId: OrNull(IdSchema),
  accountId: OrNull(IdSchema),
  toAccountId: OrNull(IdSchema),
  merchant: OrNull(Merchant),
  note: OrNull(Note),
  occurredAt: IsoTimeSchema,
  discountCents: OrNull(CentsSchema),
  feeCents: OrNull(CentsSchema),
  review: Type.Boolean(),
};

/** POST /v2/money/entries → 201 { entry }: 记一笔。没给时间就是现在，没给币种就是人民币。 */
export const RecordMoneyRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    kind: EntryFields.kind,
    amountCents: EntryFields.amountCents,
    currency: Type.Optional(EntryFields.currency),
    rate: Type.Optional(EntryFields.rate),
    categoryId: Type.Optional(EntryFields.categoryId),
    accountId: Type.Optional(EntryFields.accountId),
    toAccountId: Type.Optional(EntryFields.toAccountId),
    merchant: Type.Optional(EntryFields.merchant),
    note: Type.Optional(EntryFields.note),
    occurredAt: Type.Optional(EntryFields.occurredAt),
    discountCents: Type.Optional(EntryFields.discountCents),
    feeCents: Type.Optional(EntryFields.feeCents),
  },
  STRICT,
);
export type RecordMoneyRequest = Static<typeof RecordMoneyRequestSchema>;

/** PUT /v2/money/entries/:id → 200 { entry }: 改一笔；没给的照旧，review 不给就算你看过了（旧版做法）。 */
export const EditMoneyRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    ...Type.Partial(Type.Object(EntryFields)).properties,
  },
  STRICT,
);
export type EditMoneyRequest = Static<typeof EditMoneyRequestSchema>;

/** POST /v2/money/entries/:id/remove → 200 { entry }: 删一笔（只打时间）。 */
export const RemoveMoneyRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }) },
  STRICT,
);
export type RemoveMoneyRequest = Static<typeof RemoveMoneyRequestSchema>;

export const MoneyEntryResponseSchema = Type.Object({ entry: MoneyEntryViewSchema });
export type MoneyEntryResponse = Static<typeof MoneyEntryResponseSchema>;

/** POST /v2/money/accounts → 201 { account } */
export const AddMoneyAccountRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    name: Type.String({ minLength: 1, maxLength: 30 }),
    type: Type.Enum(MONEY_ACCOUNT_TYPES),
    openingCents: SignedCentsSchema,
    excluded: Type.Optional(Type.Boolean()),
    note: Type.Optional(OrNull(Type.String({ maxLength: 60 }))),
  },
  STRICT,
);
export type AddMoneyAccountRequest = Static<typeof AddMoneyAccountRequestSchema>;

/** PUT /v2/money/accounts/:id → 200 { account }: 改名、改期初、不计入；archived = 停用（不删）。 */
export const EditMoneyAccountRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 30 })),
    type: Type.Optional(Type.Enum(MONEY_ACCOUNT_TYPES)),
    openingCents: Type.Optional(SignedCentsSchema),
    excluded: Type.Optional(Type.Boolean()),
    note: Type.Optional(OrNull(Type.String({ maxLength: 60 }))),
    archived: Type.Optional(Type.Boolean()),
  },
  STRICT,
);
export type EditMoneyAccountRequest = Static<typeof EditMoneyAccountRequestSchema>;

export const MoneyAccountResponseSchema = Type.Object({ account: MoneyAccountViewSchema });
export type MoneyAccountResponse = Static<typeof MoneyAccountResponseSchema>;
