// 记账的存取（M5）：分类、账户、一笔一笔。金额是整数分；删一笔只打 deleted_at，停用账户只打 archived_at。
// 月汇总、统计、余额在 life/money.ts 算；这里只按时间段、按账户读。

import {
  MoneyAccountInputSchema,
  MoneyAccountPatchSchema,
  MoneyAccountSchema,
  MoneyCategoryInputSchema,
  MoneyCategoryPatchSchema,
  MoneyCategorySchema,
  MoneyEntryInputSchema,
  MoneyEntryPatchSchema,
  MoneyEntrySchema,
  type CreateOptions,
  type MoneyAccount,
  type MoneyAccountInput,
  type MoneyCategory,
  type MoneyCategoryInput,
  type MoneyEntry,
  type MoneyEntryInput,
} from '../../shared/state.ts';
import { OBJECT_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const CATEGORY_COLUMNS: ColumnMap = { ...OBJECT_META_COLUMNS, name: 'text', kind: 'text', sortOrder: 'integer' };

const ACCOUNT_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  name: 'text',
  type: 'text',
  openingCents: 'integer',
  excluded: 'boolean',
  note: 'text',
  sortOrder: 'integer',
  archivedAt: 'text',
};

const ENTRY_COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  kind: 'text',
  amountCents: 'integer',
  currency: 'text',
  cnyCents: 'integer',
  categoryId: 'text',
  accountId: 'text',
  toAccountId: 'text',
  merchant: 'text',
  note: 'text',
  occurredAt: 'text',
  discountCents: 'integer',
  feeCents: 'integer',
  origin: 'text',
  confidence: 'real',
  review: 'boolean',
  deletedAt: 'text',
};

type CategorySpec = StoreSpec<
  typeof MoneyCategorySchema,
  typeof MoneyCategoryInputSchema,
  typeof MoneyCategoryPatchSchema
>;
const CATEGORY_SPEC: CategorySpec = {
  table: 'money_categories',
  schema: MoneyCategorySchema,
  input: MoneyCategoryInputSchema,
  patch: MoneyCategoryPatchSchema,
  columns: CATEGORY_COLUMNS,
  defaults: {},
};

type AccountSpec = StoreSpec<typeof MoneyAccountSchema, typeof MoneyAccountInputSchema, typeof MoneyAccountPatchSchema>;
const ACCOUNT_SPEC: AccountSpec = {
  table: 'money_accounts',
  schema: MoneyAccountSchema,
  input: MoneyAccountInputSchema,
  patch: MoneyAccountPatchSchema,
  columns: ACCOUNT_COLUMNS,
  defaults: { excluded: false, note: null, sortOrder: 0, archivedAt: null },
};

type EntrySpec = StoreSpec<typeof MoneyEntrySchema, typeof MoneyEntryInputSchema, typeof MoneyEntryPatchSchema>;
const ENTRY_SPEC: EntrySpec = {
  table: 'money_entries',
  schema: MoneyEntrySchema,
  input: MoneyEntryInputSchema,
  patch: MoneyEntryPatchSchema,
  columns: ENTRY_COLUMNS,
  defaults: { deletedAt: null },
};

const LIVE = 'deleted_at IS NULL';

export function createMoneyStores(context: StoreContext) {
  const categories = new ObjectStore(context, CATEGORY_SPEC);
  const accounts = new ObjectStore(context, ACCOUNT_SPEC);
  const entries = new ObjectStore(context, ENTRY_SPEC);

  return {
    moneyCategories: {
      get: categories.get.bind(categories),
      create: (input: MoneyCategoryInput, options: CreateOptions = {}): MoneyCategory =>
        categories.create(input, undefined, options),
      all: (): MoneyCategory[] =>
        allPages((page) => categories.select('1 = 1', {}, page, 'sort_order, id')),
    },
    moneyAccounts: {
      get: accounts.get.bind(accounts),
      require: accounts.require.bind(accounts),
      update: accounts.update.bind(accounts),
      create: (input: MoneyAccountInput, options: CreateOptions = {}): MoneyAccount =>
        accounts.create(input, undefined, options),
      /** Accounts in use (not archived), in their order. */
      active: (): MoneyAccount[] =>
        allPages((page) => accounts.select('archived_at IS NULL', {}, page, 'sort_order, created_at, id')),
      count: (): number => Number(context.db.get('SELECT count(*) AS n FROM money_accounts')?.['n'] ?? 0),
    },
    moneyEntries: {
      get: entries.get.bind(entries),
      require: entries.require.bind(entries),
      update: entries.update.bind(entries),
      create: (input: MoneyEntryInput, options: CreateOptions = {}): MoneyEntry =>
        entries.create(input, undefined, options),
      /** Live entries with `from <= occurred_at < to`, newest first. */
      between: (from: string, to: string): MoneyEntry[] =>
        allPages((page) =>
          entries.select(`${LIVE} AND occurred_at >= $from AND occurred_at < $to`, { from, to }, page,
            'occurred_at DESC, id DESC'),
        ),
      /** Every live entry (balances add them all up). */
      all: (): MoneyEntry[] => allPages((page) => entries.select(LIVE, {}, page, 'occurred_at, id')),
      reviewCount: (): number =>
        Number(context.db.get(`SELECT count(*) AS n FROM money_entries WHERE ${LIVE} AND review = 1`)?.['n'] ?? 0),
      /**
       * The category this merchant was last filed under by an entry you have looked at (not「待看」), newest change
       * first: change it once and the merchant follows the change (《置信度与做事方式改动方案》第二批).
       */
      merchantCategory: (merchant: string): string | null => {
        const row = context.db.get(`SELECT category_id FROM money_entries WHERE ${LIVE} AND review = 0
          AND category_id IS NOT NULL AND lower(trim(merchant)) = lower(trim($merchant))
          ORDER BY updated_at DESC, id DESC LIMIT 1`, { merchant });
        return row === undefined ? null : String(row['category_id']);
      },
      /** A live entry for the same payment: same kind, amount, currency and time (查重). */
      samePayment: (fields: { kind: string; amountCents: number; currency: string; occurredAt: string }):
        MoneyEntry | undefined => entries.select(`${LIVE} AND kind = $kind AND amount_cents = $amount
          AND currency = $currency AND occurred_at = $occurred_at`, { kind: fields.kind, amount: fields.amountCents,
        currency: fields.currency, occurred_at: fields.occurredAt }, { limit: 1 })[0],
      /** Live entries created in [from, to) and how many of them still wait for a look (每周汇总). */
      createdBetween: (from: string, to: string): { created: number; review: number } => {
        const row = context.db.get(`SELECT count(*) AS n, coalesce(sum(review), 0) AS r FROM money_entries
          WHERE ${LIVE} AND created_at >= $from AND created_at < $to`, { from, to });
        return { created: Number(row?.['n'] ?? 0), review: Number(row?.['r'] ?? 0) };
      },
    },
  };
}

export type MoneyStores = ReturnType<typeof createMoneyStores>;
