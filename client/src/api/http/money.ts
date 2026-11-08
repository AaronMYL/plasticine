// /v2/money 的真实现：账本、统计、记一笔、改一笔、删一笔、加账户、改账户。带 version 的过时了换成带 current 的 ConflictError。

import type { MoneyApi } from '../m5b-client.ts';
import {
  MONEY_ACCOUNTS_PATH,
  MONEY_ENTRIES_PATH,
  MONEY_PATH,
  MONEY_STATS_PATH,
  MoneyAccountResponseSchema,
  MoneyAccountViewSchema,
  MoneyEntryResponseSchema,
  MoneyEntryViewSchema,
  MoneyResponseSchema,
  MoneyStatsResponseSchema,
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
import { conflictWith } from './conflict.ts';
import type { HttpMethod, Transport } from './transport.ts';

export class HttpMoney implements MoneyApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  month(query: MoneyQuery, signal?: AbortSignal): Promise<MoneyResponse> {
    return this.transport.request({
      method: 'GET',
      path: MONEY_PATH,
      query: { month: query.month, tz: query.tz },
      schema: MoneyResponseSchema,
      what: '读账本',
      lostAs: 'failed',
      signal,
    });
  }

  stats(query: MoneyStatsQuery, signal?: AbortSignal): Promise<MoneyStatsResponse> {
    return this.transport.request({
      method: 'GET',
      path: MONEY_STATS_PATH,
      query: { range: query.range, anchor: query.anchor, tz: query.tz },
      schema: MoneyStatsResponseSchema,
      what: '读统计',
      lostAs: 'failed',
      signal,
    });
  }

  record(input: RecordMoneyRequest): Promise<MoneyEntryView> {
    return this.entry('POST', MONEY_ENTRIES_PATH, input, '记一笔');
  }

  edit(id: string, input: EditMoneyRequest): Promise<MoneyEntryView> {
    return this.entry('PUT', `${MONEY_ENTRIES_PATH}/${encodeURIComponent(id)}`, input, '改一笔');
  }

  remove(id: string, input: RemoveMoneyRequest): Promise<MoneyEntryView> {
    return this.entry('POST', `${MONEY_ENTRIES_PATH}/${encodeURIComponent(id)}/remove`, input, '删一笔');
  }

  addAccount(input: AddMoneyAccountRequest): Promise<MoneyAccountView> {
    return this.account('POST', MONEY_ACCOUNTS_PATH, input, '加账户');
  }

  editAccount(id: string, input: EditMoneyAccountRequest): Promise<MoneyAccountView> {
    return this.account('PUT', `${MONEY_ACCOUNTS_PATH}/${encodeURIComponent(id)}`, input, '改账户');
  }

  private async entry(method: HttpMethod, path: string, body: unknown, what: string): Promise<MoneyEntryView> {
    const response = await this.transport.request({
      method,
      path,
      body,
      schema: MoneyEntryResponseSchema,
      what,
      lostAs: 'uncertain',
      refine: conflictWith(MoneyEntryViewSchema),
    });
    return response.entry;
  }

  private async account(method: HttpMethod, path: string, body: unknown, what: string): Promise<MoneyAccountView> {
    const response = await this.transport.request({
      method,
      path,
      body,
      schema: MoneyAccountResponseSchema,
      what,
      lostAs: 'uncertain',
      refine: conflictWith(MoneyAccountViewSchema),
    });
    return response.account;
  }
}
