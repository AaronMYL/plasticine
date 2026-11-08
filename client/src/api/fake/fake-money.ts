// 假的记账：分类（旧版默认那一套）、账户、一笔一笔，按用户时区分天汇总，和真服务端（agent/src/life/money.ts）同一套算法：
// 人民币原样、外币按汇率折、删只打时间；写操作按 requestId 幂等，带 version 的过时了回 409 和现在那一条，变了推 money.changed。

import type { MoneyApi } from '../m5b-client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import {
  MONEY_DEFAULT_CATEGORIES,
  moneyAmounts,
  type AddMoneyAccountRequest,
  type EditMoneyAccountRequest,
  type EditMoneyRequest,
  type MoneyAccountView,
  type MoneyEntryView,
  type MoneyQuery,
  type MoneyResponse,
  type MoneyStatsQuery,
  type MoneyStatsResponse,
  type RecordMoneyRequest,
  type RemoveMoneyRequest,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import { dayIn, localZone } from './fake-feed.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeMoneyDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
}

const STALE_NEXT = '看 current 里的最新版，确认后用最新的 version 再来。';

function invalid(message: string, field: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', message, field, status: 400 });
}

function notFound(what: string): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: `没有找到${what}。`, status: 404 });
}

export class FakeMoney implements MoneyApi {
  private readonly entries = new Map<string, MoneyEntryView>();
  private readonly accounts = new Map<string, Omit<MoneyAccountView, 'balanceCents'> & { archived: boolean }>();
  private readonly deps: FakeMoneyDeps;
  private sequence = 0;

  constructor(deps: FakeMoneyDeps) {
    this.deps = deps;
  }

  async month(query: MoneyQuery): Promise<MoneyResponse> {
    this.deps.session.require();
    const zone = query.tz ?? localZone();
    const list = this.live().filter((entry) => dayIn(new Date(entry.occurredAt), zone).startsWith(query.month));
    const days = new Map<string, MoneyEntryView[]>();
    for (const entry of list) {
      const day = dayIn(new Date(entry.occurredAt), zone);
      days.set(day, [...(days.get(day) ?? []), entry]);
    }
    const expenseCents = spent(list);
    const incomeCents = sum(list, 'income');
    const accounts = this.balances();
    const counted = accounts.filter((account) => !account.excluded);
    const assetsCents = counted.filter((row) => row.balanceCents > 0).reduce((n, row) => n + row.balanceCents, 0);
    const debtsCents = counted.filter((row) => row.balanceCents < 0).reduce((n, row) => n - row.balanceCents, 0);
    return {
      month: query.month,
      expenseCents,
      incomeCents,
      balanceCents: incomeCents - expenseCents,
      review: list.filter((entry) => entry.review).length,
      days: [...days.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, rows]) => ({ date, expenseCents: spent(rows), incomeCents: sum(rows, 'income'), entries: rows })),
      categories: MONEY_DEFAULT_CATEGORIES.map(({ id, name, kind }) => ({ id, name, kind })),
      accounts,
      assetsCents,
      debtsCents,
      netCents: assetsCents - debtsCents,
    };
  }

  async stats(query: MoneyStatsQuery): Promise<MoneyStatsResponse> {
    this.deps.session.require();
    const list = this.live();
    const expenseCents = spent(list);
    const incomeCents = sum(list, 'income');
    return {
      range: query.range,
      from: query.anchor,
      to: query.anchor,
      expenseCents,
      incomeCents,
      balanceCents: incomeCents - expenseCents,
      refundCents: sum(list, 'refund'),
      discountCents: 0,
      feeCents: list.reduce((total, entry) => total + (entry.feeCents ?? 0), 0),
      monthlyAverageCents: expenseCents,
      count: list.length,
      byCategory: [],
    };
  }

  async record(input: RecordMoneyRequest): Promise<MoneyEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('money', input.requestId, 'POST /v2/money/entries', () => {
      this.sequence += 1;
      const entry = this.build(`m_${this.sequence}`, input, 1);
      return this.put(entry);
    });
  }

  recordConfirmed(id: string, fields: import('../shared.ts').PaymentFields): MoneyEntryView {
    const existing = this.entries.get(id);
    if (existing !== undefined) { return existing; }
    return this.put({ ...this.build(id, fields, 1), origin: 'ai', review: false });
  }

  async edit(id: string, input: EditMoneyRequest): Promise<MoneyEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('money', input.requestId, `PUT /v2/money/entries/${id}`, () => {
      const current = this.writable(id, input.version);
      const { requestId: _id, version: _version, ...fields } = input;
      const merged = { ...current, ...fields, review: fields.review ?? false };
      return this.put(this.build(id, merged, current.version + 1));
    });
  }

  async remove(id: string, input: RemoveMoneyRequest): Promise<MoneyEntryView> {
    this.deps.session.require();
    return this.deps.receipts.run('money', input.requestId, `POST /v2/money/entries/${id}/remove`, () => {
      const current = this.writable(id, input.version);
      return this.put({ ...current, deleted: true, version: current.version + 1 });
    });
  }

  async addAccount(input: AddMoneyAccountRequest): Promise<MoneyAccountView> {
    this.deps.session.require();
    return this.deps.receipts.run('money', input.requestId, 'POST /v2/money/accounts', () => {
      this.sequence += 1;
      const id = `acc_${this.sequence}`;
      const account = {
        id,
        name: input.name,
        type: input.type,
        openingCents: input.openingCents,
        excluded: input.excluded ?? false,
        note: input.note ?? null,
        version: 1,
        archived: false,
      };
      this.accounts.set(id, account);
      return this.balanceOf(id);
    });
  }

  async editAccount(id: string, input: EditMoneyAccountRequest): Promise<MoneyAccountView> {
    this.deps.session.require();
    return this.deps.receipts.run('money', input.requestId, `PUT /v2/money/accounts/${id}`, () => {
      const current = this.accounts.get(id);
      if (current === undefined) {
        throw notFound('这个账户');
      }
      if (current.version !== input.version) {
        throw new ConflictError(this.balanceOf(id), '这个账户在别处改过了，这次没有改。', STALE_NEXT);
      }
      const { requestId: _id, version: _version, archived, ...fields } = input;
      const next = { ...current, ...fields, archived: archived ?? current.archived, version: current.version + 1 };
      this.accounts.set(id, next);
      return this.balanceOf(id);
    });
  }

  find(id: string): MoneyEntryView | undefined {
    return this.entries.get(id);
  }

  private live(): MoneyEntryView[] {
    return [...this.entries.values()]
      .filter((entry) => !entry.deleted)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  private balances(): MoneyAccountView[] {
    return [...this.accounts.values()]
      .filter((account) => !account.archived)
      .map((account) => this.balanceOf(account.id));
  }

  private balanceOf(id: string): MoneyAccountView {
    const account = this.accounts.get(id);
    if (account === undefined) {
      throw notFound('这个账户');
    }
    let balanceCents = account.openingCents;
    for (const entry of this.live()) {
      if (entry.accountId === id) {
        const amounts = moneyAmounts(entry);
        balanceCents += amounts.income - amounts.expense - amounts.transfer;
      }
      if (entry.kind === 'transfer' && entry.toAccountId === id) {
        balanceCents += entry.cnyCents;
      }
    }
    const { archived: _archived, ...view } = account;
    return { ...view, balanceCents };
  }

  private writable(id: string, version: number): MoneyEntryView {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.deleted) {
      throw notFound('这笔账');
    }
    if (entry.version !== version) {
      throw new ConflictError(entry, '这笔账在别处改过了，这次没有改。', STALE_NEXT);
    }
    return entry;
  }

  private build(
    id: string,
    input: Partial<MoneyEntryView> & RecordMoneyRequestFields,
    version: number,
  ): MoneyEntryView {
    const currency = input.currency ?? 'CNY';
    const rate = input.rate ?? null;
    const category = MONEY_DEFAULT_CATEGORIES.find((row) => row.id === input.categoryId);
    if (input.categoryId !== undefined && input.categoryId !== null && category === undefined) {
      throw invalid('没有这个分类。', 'categoryId');
    }
    const kind = input.kind === 'refund' ? 'expense' : input.kind;
    if (category !== undefined && category.kind !== kind) {
      throw invalid('分类和收支种类不匹配，请重新选择分类。', 'categoryId');
    }
    if (input.kind === 'transfer' && (input.accountId ?? null) === (input.toAccountId ?? null)) {
      throw invalid('转账要选两个不同的账户。', 'toAccountId');
    }
    return {
      id,
      kind: input.kind,
      amountCents: input.amountCents,
      currency,
      cnyCents: currency === 'CNY' || rate === null ? input.amountCents : Math.round(input.amountCents * rate),
      categoryId: input.categoryId ?? null,
      categoryName: category?.name ?? null,
      accountId: input.accountId ?? null,
      toAccountId: input.kind === 'transfer' ? (input.toAccountId ?? null) : null,
      merchant: input.merchant ?? null,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? this.deps.now().toISOString(),
      discountCents: input.discountCents ?? null,
      feeCents: input.feeCents ?? null,
      origin: 'manual',
      confidence: null,
      review: input.review ?? false,
      deleted: false,
      migrated: false,
      version,
    };
  }

  private put(entry: MoneyEntryView): MoneyEntryView {
    this.entries.set(entry.id, entry);
    this.deps.bus.emit({ type: 'money.changed', entry });
    return entry;
  }

  /** 预置一笔（本地开发、测试）。 */
  seed(fields: Pick<MoneyEntryView, 'id' | 'amountCents'> & Partial<MoneyEntryView>): MoneyEntryView {
    const entry = { ...this.build(fields.id, { kind: 'expense', ...fields }, 1), ...fields };
    this.entries.set(entry.id, entry);
    return entry;
  }
}

type RecordMoneyRequestFields = Pick<RecordMoneyRequest, 'kind' | 'amountCents'> & {
  rate?: number | null | undefined;
};

function sum(list: readonly MoneyEntryView[], kind: MoneyEntryView['kind']): number {
  return list.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.cnyCents, 0);
}

function spent(list: readonly MoneyEntryView[]): number {
  return list.reduce((total, entry) => total + moneyAmounts(entry).expense, 0);
}
