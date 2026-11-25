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

export const MoneyQuerySchema = Type.Object({ month: MonthSchema, tz: Type.Optional(TimeZoneSchema) }, STRICT);
export type MoneyQuery = Static<typeof MoneyQuerySchema>;
export const MoneyResponseSchema = Type.Object({
  month: MonthSchema,
  expenseCents: Type.Integer(),
  incomeCents: Type.Integer(),
  balanceCents: Type.Integer(),
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

export const EditMoneyRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    ...Type.Partial(Type.Object(EntryFields)).properties,
  },
  STRICT,
);
export type EditMoneyRequest = Static<typeof EditMoneyRequestSchema>;

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
