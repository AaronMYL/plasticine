// /v2/money: 记账页——这个月的账本（按天）、分类、账户和资产，统计（周 / 月 / 年），记一笔、改一笔、删一笔（只打时间），
// 加账户、改账户（停用不删）。写操作按 requestId 幂等，带 version 的过时了 409 带现在那一条；提交之后才推 money_changed。

import {
  AddMoneyAccountRequestSchema,
  DEFAULT_TIME_ZONE,
  EditMoneyAccountRequestSchema,
  EditMoneyRequestSchema,
  MoneyQuerySchema,
  MoneyStatsQuerySchema,
  RecordMoneyRequestSchema,
  RemoveMoneyRequestSchema,
  type MoneyAccountResponse,
  type MoneyEntryResponse,
  type MoneyResponse,
  type MoneyStatsResponse,
} from '../../shared/api/index.ts';
import type { MoneyAccountPatch } from '../../shared/state.ts';
import { withCurrent } from './conflict.ts';
import { param, requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { moneyAccountView, moneyEntryView } from './m5b-views.ts';
import { checkInput, queryObject } from './validate.ts';

function entryWrite<T>(deps: AppDeps, id: string, write: () => T): T {
  const read = () => deps.state.moneyEntries.require(id);
  return withCurrent(write, () => moneyEntryView(deps.state, read()), () => read().version);
}

function accountView(deps: AppDeps, id: string) {
  const row = deps.m5b.life.money.assets().accounts.find((candidate) => candidate.account.id === id);
  const account = deps.state.moneyAccounts.require(id);
  return moneyAccountView(row ?? { account, balanceCents: account.openingCents });
}

/** GET /v2/money?month=&tz= */
export function getMoney(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(MoneyQuerySchema, queryObject(context.url.searchParams), '查询参数');
  const { state, m5b } = context.deps;
  const { money } = m5b.life;
  const summary = money.month(query.month, query.tz ?? DEFAULT_TIME_ZONE);
  const assets = money.assets();
  const body: MoneyResponse = {
    month: summary.month,
    expenseCents: summary.expenseCents,
    incomeCents: summary.incomeCents,
    balanceCents: summary.balanceCents,
    review: summary.review,
    days: summary.days.map((day) => ({
      date: day.date,
      expenseCents: day.expenseCents,
      incomeCents: day.incomeCents,
      entries: day.entries.map((entry) => moneyEntryView(state, entry)),
    })),
    categories: money.categories().map((category) => ({ id: category.id, name: category.name, kind: category.kind })),
    accounts: assets.accounts.map(moneyAccountView),
    assetsCents: assets.assetsCents,
    debtsCents: assets.debtsCents,
    netCents: assets.netCents,
  };
  return { status: 200, body };
}

/** GET /v2/money/stats?range=&anchor=&tz= */
export function getMoneyStats(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(MoneyStatsQuerySchema, queryObject(context.url.searchParams), '查询参数');
  const stats = context.deps.m5b.life.money.stats(query.range, query.anchor, query.tz ?? DEFAULT_TIME_ZONE);
  const body: MoneyStatsResponse = stats;
  return { status: 200, body };
}

/** POST /v2/money/entries */
export async function recordMoney(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const { requestId, ...draft } = checkInput(RecordMoneyRequestSchema, await readJsonBody(context.req), '记一笔');
  const { deps } = context;
  return idempotent(context, requestId, (afterCommit) => {
    const entry = deps.m5b.life.money.record(
      { ...draft, origin: auth.actor === 'system' ? 'brain' : 'manual' }, afterCommit);
    const body: MoneyEntryResponse = { entry: moneyEntryView(deps.state, entry) };
    return { status: 201, body };
  });
}

/** PUT /v2/money/entries/:id */
export async function editMoney(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const { requestId, version, ...draft } = checkInput(EditMoneyRequestSchema, await readJsonBody(context.req), '改一笔');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, requestId, (afterCommit) => {
    // Not saying review means you looked at it (1ca0391 money.ts update).
    const patch = { ...draft, review: draft.review ?? false };
    const entry = entryWrite(deps, id, () => deps.m5b.life.money.edit(id, version, patch, afterCommit));
    const body: MoneyEntryResponse = { entry: moneyEntryView(deps.state, entry) };
    return { status: 200, body };
  });
}

/** POST /v2/money/entries/:id/remove */
export async function removeMoney(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(RemoveMoneyRequestSchema, await readJsonBody(context.req), '删一笔');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const entry = entryWrite(deps, id, () => deps.m5b.life.money.remove(id, body.version, afterCommit));
    const response: MoneyEntryResponse = { entry: moneyEntryView(deps.state, entry) };
    return { status: 200, body: response };
  });
}

/** POST /v2/money/accounts */
export async function addMoneyAccount(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const { requestId, ...input } = checkInput(AddMoneyAccountRequestSchema, await readJsonBody(context.req), '加账户');
  const { deps } = context;
  return idempotent(context, requestId, () => {
    const account = deps.m5b.life.money.addAccount(input);
    const body: MoneyAccountResponse = { account: accountView(deps, account.id) };
    return { status: 201, body };
  });
}

/** PUT /v2/money/accounts/:id */
export async function editMoneyAccount(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const input = checkInput(EditMoneyAccountRequestSchema, await readJsonBody(context.req), '改账户');
  const id = param(context, 'id');
  const { deps } = context;
  const { requestId, version, archived, ...fields } = input;
  return idempotent(context, requestId, () => {
    const patch: MoneyAccountPatch = { ...fields };
    if (archived !== undefined) {
      patch.archivedAt = archived ? deps.now().toISOString() : null;
    }
    const read = () => deps.state.moneyAccounts.require(id);
    withCurrent(
      () => deps.state.moneyAccounts.update(id, version, patch),
      () => accountView(deps, id),
      () => read().version,
    );
    const body: MoneyAccountResponse = { account: accountView(deps, id) };
    return { status: 200, body };
  });
}
