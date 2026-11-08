// 记账（《UI 方案》第 2 节：账目、账户、资产、统计；照 1ca0391 money.ts 的算法）：一笔一笔记成整数分，非人民币按给的汇率
// 折成人民币分另存（没给汇率就按原币计）；转账要两个不同的、在用的账户；分类和账户只认已有的。账本页按月、按天分组，
// 统计页按周 / 月 / 年，资产页每个账户的余额 = 期初 + 收入 − 支出 + 退款 ± 转账（手续费算支出），「不计入」的不进总数。

import {
  MONEY_DEFAULT_CATEGORIES,
  type MoneyAccount,
  type MoneyAccountInput,
  type MoneyCategory,
  type MoneyEntry,
  type MoneyEntryInput,
} from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { moneyAmounts } from '../../shared/money-amounts.ts';
import { LifeError } from './errors.ts';
import { dayOf, inSpan, monthSpan, rangeSpan, widenedInstants, type DaySpan, type StatRange } from './periods.ts';

export const BASE_CURRENCY = 'CNY';
// 一个汇率最多这么大（1 单位外币换多少人民币）；再大多半是填错了。
const RATE_MAX = 10_000;

/** The default categories (shared/state-life.ts, 1ca0391 money.ts). */
export const DEFAULT_CATEGORIES = MONEY_DEFAULT_CATEGORIES;

/** What a caller asks to record: the base currency is computed here, never taken from outside. */
export interface EntryDraft {
  kind: MoneyEntry['kind'];
  amountCents: number;
  currency?: string;
  /** 1 unit of `currency` in yuan; ignored for CNY. */
  rate?: number | null;
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  merchant?: string | null;
  note?: string | null;
  occurredAt?: string;
  discountCents?: number | null;
  feeCents?: number | null;
  confidence?: number | null;
  review?: boolean;
  origin: MoneyEntry['origin'];
}

export interface DaySummary {
  date: string;
  expenseCents: number;
  incomeCents: number;
  entries: MoneyEntry[];
}

export interface MonthSummary {
  month: string;
  expenseCents: number;
  incomeCents: number;
  balanceCents: number;
  review: number;
  days: DaySummary[];
}

export interface CategoryShare {
  categoryId: string;
  name: string;
  amountCents: number;
  /** 0–1 of this period's spending. */
  share: number;
}

export interface Stats {
  range: StatRange;
  from: string;
  to: string;
  expenseCents: number;
  incomeCents: number;
  balanceCents: number;
  refundCents: number;
  discountCents: number;
  feeCents: number;
  monthlyAverageCents: number;
  count: number;
  byCategory: CategoryShare[];
}

export interface AccountBalance {
  account: MoneyAccount;
  balanceCents: number;
}

export interface Assets {
  accounts: AccountBalance[];
  assetsCents: number;
  debtsCents: number;
  netCents: number;
}

/** Runs an action once the surrounding transaction committed (app/idempotency.ts). */
export type AfterCommit = (action: () => void) => void;

export interface MoneySink {
  entryChanged(entry: MoneyEntry): void;
}

function sumOf(entries: readonly MoneyEntry[], kind: MoneyEntry['kind']): number {
  return entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entry.cnyCents, 0);
}

/** Spending net of refunds, as the old ledger counted it. */
function spentOf(entries: readonly MoneyEntry[]): number {
  return entries.reduce((sum, entry) => sum + moneyAmounts(entry).expense, 0);
}

export class MoneyDesk {
  readonly #state: StateService;
  readonly #now: () => Date;
  #sink: MoneySink | null = null;

  constructor(options: { state: StateService; now: () => Date }) {
    this.#state = options.state;
    this.#now = options.now;
  }

  attach(sink: MoneySink): void {
    this.#sink = sink;
  }

  /** The categories, the defaults made the first time (fixed ids, so a second start makes nothing new). */
  categories(): MoneyCategory[] {
    const state = this.#state;
    const existing = state.moneyCategories.all();
    if (existing.length > 0) {
      return existing;
    }
    return state.transaction(() => {
      DEFAULT_CATEGORIES.forEach((category, index) => {
        if (state.moneyCategories.get(category.id) === undefined) {
          const order = category.kind === 'income' ? 100 + index : index;
          state.moneyCategories.create({ name: category.name, kind: category.kind, sortOrder: order }, {
            id: category.id,
          });
        }
      });
      return state.moneyCategories.all();
    });
  }

  accounts(): MoneyAccount[] {
    return this.#state.moneyAccounts.active();
  }

  addAccount(input: MoneyAccountInput): MoneyAccount {
    const sortOrder = input.sortOrder ?? this.#state.moneyAccounts.count();
    return this.#state.moneyAccounts.create({ ...input, sortOrder });
  }

  record(draft: EntryDraft, afterCommit?: AfterCommit): MoneyEntry {
    const entry = this.#state.moneyEntries.create(this.#input(draft));
    this.#notify(entry, afterCommit);
    return entry;
  }

  /** Changes fields of an entry; what is not given keeps its value. */
  edit(id: string, version: number, draft: Partial<EntryDraft>, afterCommit?: AfterCommit): MoneyEntry {
    const current = this.#live(id);
    const merged: EntryDraft = {
      ...current,
      rate: current.currency === BASE_CURRENCY ? null : current.cnyCents / current.amountCents,
      ...draft,
      origin: current.origin,
    };
    const { origin: _origin, ...input } = this.#input(merged);
    const entry = this.#state.moneyEntries.update(id, version, input);
    this.#notify(entry, afterCommit);
    return entry;
  }

  remove(id: string, version: number, afterCommit?: AfterCommit): MoneyEntry {
    this.#live(id);
    const entry = this.#state.moneyEntries.update(id, version, { deletedAt: this.#now().toISOString() });
    this.#notify(entry, afterCommit);
    return entry;
  }

  month(month: string, timeZone: string): MonthSummary {
    const span = monthSpan(month);
    const entries = this.#inSpan(span, timeZone);
    const days = new Map<string, MoneyEntry[]>();
    for (const entry of entries) {
      const day = dayOf(entry.occurredAt, timeZone);
      days.set(day, [...(days.get(day) ?? []), entry]);
    }
    const expenseCents = spentOf(entries);
    const incomeCents = sumOf(entries, 'income');
    return {
      month,
      expenseCents,
      incomeCents,
      balanceCents: incomeCents - expenseCents,
      review: entries.filter((entry) => entry.review).length,
      days: [...days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, list]) => ({
          date,
          expenseCents: spentOf(list),
          incomeCents: sumOf(list, 'income'),
          entries: list,
        })),
    };
  }

  stats(range: StatRange, anchor: string, timeZone: string): Stats {
    const span = rangeSpan(range, anchor);
    const entries = this.#inSpan(span, timeZone);
    const expenseCents = spentOf(entries);
    const incomeCents = sumOf(entries, 'income');
    const fees = entries.reduce((sum, entry) => sum + (entry.feeCents ?? 0), 0);
    const spending = sumOf(entries, 'expense') + fees;
    const names = new Map(this.categories().map((category) => [category.id, category.name]));
    const by = new Map<string, number>();
    if (fees > 0) {
      by.set('fees', fees);
      names.set('fees', '手续费');
    }
    for (const entry of entries.filter((candidate) => candidate.kind === 'expense')) {
      const key = entry.categoryId ?? 'other';
      by.set(key, (by.get(key) ?? 0) + entry.cnyCents);
    }
    const months = range === 'year'
      ? Math.max(1, new Set(entries.map((entry) => dayOf(entry.occurredAt, timeZone).slice(0, 7))).size)
      : 1;
    return {
      range,
      ...span,
      expenseCents,
      incomeCents,
      balanceCents: incomeCents - expenseCents,
      refundCents: sumOf(entries, 'refund'),
      discountCents: entries.reduce((sum, entry) => sum + (entry.discountCents ?? 0), 0),
      feeCents: fees,
      monthlyAverageCents: Math.round(expenseCents / months),
      count: entries.length,
      byCategory: [...by.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([categoryId, amountCents]) => ({
          categoryId,
          name: names.get(categoryId) ?? '其他',
          amountCents,
          share: spending === 0 ? 0 : amountCents / spending,
        })),
    };
  }

  assets(): Assets {
    const entries = this.#state.moneyEntries.all();
    const accounts = this.accounts().map((account) => {
      let balanceCents = account.openingCents;
      for (const entry of entries) {
        const amounts = moneyAmounts(entry);
        if (entry.accountId === account.id) {
          balanceCents += amounts.income - amounts.expense - amounts.transfer;
        }
        if (entry.kind === 'transfer' && entry.toAccountId === account.id) {
          balanceCents += entry.cnyCents;
        }
      }
      return { account, balanceCents };
    });
    const counted = accounts.filter((row) => !row.account.excluded);
    const assetsCents = counted.filter((row) => row.balanceCents > 0).reduce((sum, row) => sum + row.balanceCents, 0);
    const debtsCents = counted.filter((row) => row.balanceCents < 0).reduce((sum, row) => sum - row.balanceCents, 0);
    return { accounts, assetsCents, debtsCents, netCents: assetsCents - debtsCents };
  }

  #notify(entry: MoneyEntry, afterCommit: AfterCommit | undefined): void {
    const sink = this.#sink;
    if (sink === null) {
      return;
    }
    const tell = (): void => sink.entryChanged(entry);
    if (afterCommit === undefined) {
      tell();
    } else {
      afterCommit(tell);
    }
  }

  #live(id: string): MoneyEntry {
    const entry = this.#state.moneyEntries.get(id);
    if (entry === undefined || entry.deletedAt !== null) {
      throw new LifeError('not_found', '这笔账不在了。');
    }
    return entry;
  }

  #inSpan(span: DaySpan, timeZone: string): MoneyEntry[] {
    const { from, to } = widenedInstants(span);
    return this.#state.moneyEntries
      .between(from, to)
      .filter((entry) => inSpan(dayOf(entry.occurredAt, timeZone), span));
  }

  #reference(id: string | null | undefined, field: 'accountId' | 'toAccountId'): string | null {
    if (id === undefined || id === null) {
      return null;
    }
    const account = this.#state.moneyAccounts.get(id);
    if (account === undefined || account.archivedAt !== null) {
      throw new LifeError('invalid_input', '这个账户不存在或已经停用。', field);
    }
    return account.id;
  }

  #input(draft: EntryDraft): MoneyEntryInput {
    const currency = (draft.currency ?? BASE_CURRENCY).toUpperCase();
    const cnyCents = this.#cny(draft.amountCents, currency, draft.rate ?? null);
    const categoryId = draft.categoryId ?? null;
    if (categoryId !== null) {
      const category = this.categories().find((row) => row.id === categoryId);
      if (category === undefined) {
        throw new LifeError('invalid_input', '没有这个分类。', 'categoryId');
      }
      const kind = draft.kind === 'refund' ? 'expense' : draft.kind;
      if (category.kind !== kind) {
        throw new LifeError('invalid_input', '分类和收支种类不匹配，请重新选择分类。', 'categoryId');
      }
    }
    const accountId = this.#reference(draft.accountId, 'accountId');
    const toAccountId = draft.kind === 'transfer' ? this.#reference(draft.toAccountId, 'toAccountId') : null;
    if (draft.kind === 'transfer' && (accountId === null || toAccountId === null || accountId === toAccountId)) {
      throw new LifeError('invalid_input', '转账要选两个不同的账户。', 'toAccountId');
    }
    return {
      kind: draft.kind,
      amountCents: draft.amountCents,
      currency,
      cnyCents,
      categoryId,
      accountId,
      toAccountId,
      merchant: draft.merchant?.trim() || null,
      note: draft.note?.trim() || null,
      occurredAt: draft.occurredAt ?? this.#now().toISOString(),
      discountCents: draft.discountCents ?? null,
      feeCents: draft.feeCents ?? null,
      confidence: draft.confidence ?? null,
      review: draft.review ?? false,
      origin: draft.origin,
    };
  }

  #cny(amountCents: number, currency: string, rate: number | null): number {
    if (currency === BASE_CURRENCY) {
      return amountCents;
    }
    if (rate === null) {
      // 没有汇率就按原币计（1ca0391 money.ts），统计时混在一起，界面标出币种。
      return amountCents;
    }
    if (!Number.isFinite(rate) || rate <= 0 || rate > RATE_MAX) {
      throw new LifeError('invalid_input', '汇率要是正数。', 'rate');
    }
    return Math.round(amountCents * rate);
  }
}
