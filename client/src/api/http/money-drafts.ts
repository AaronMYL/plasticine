import type { MoneyDraftsApi } from '../client.ts';
import {
  MONEY_DRAFT_SUMMARY_PATH,
  MONEY_DRAFTS_PATH,
  MONEY_ORIGINALS_PURGE_PATH,
  MoneyDraftSummarySchema,
  MoneyDraftViewSchema,
  PurgeOriginalsResponseSchema,
  type PurgeOriginalsRequest,
  type CreateMoneyDraftRequest,
  type EditMoneyDraftRequest,
  type RejectMoneyDraftRequest,
} from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpMoneyDrafts implements MoneyDraftsApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  get(id: string, signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: `${MONEY_DRAFTS_PATH}/${encodeURIComponent(id)}`,
      schema: MoneyDraftViewSchema,
      what: '读取记账草案',
      lostAs: 'failed',
      ...(signal === undefined ? {} : { signal }),
    });
  }
  create(body: CreateMoneyDraftRequest) {
    return this.transport.request({
      method: 'POST',
      path: MONEY_DRAFTS_PATH,
      body,
      schema: MoneyDraftViewSchema,
      what: '识别付款截图',
      lostAs: 'uncertain',
    });
  }
  edit(id: string, body: EditMoneyDraftRequest) {
    return this.transport.request({
      method: 'PUT',
      path: `${MONEY_DRAFTS_PATH}/${encodeURIComponent(id)}`,
      body,
      schema: MoneyDraftViewSchema,
      what: '保存记账核对',
      lostAs: 'uncertain',
    });
  }
  reject(id: string, body: RejectMoneyDraftRequest) {
    return this.transport.request({
      method: 'POST',
      path: `${MONEY_DRAFTS_PATH}/${encodeURIComponent(id)}/reject`,
      body,
      schema: MoneyDraftViewSchema,
      what: '不记这笔',
      lostAs: 'uncertain',
    });
  }
  summary(signal?: AbortSignal) {
    return this.transport.request({
      method: 'GET',
      path: MONEY_DRAFT_SUMMARY_PATH,
      schema: MoneyDraftSummarySchema,
      what: '读取截图记账汇总',
      lostAs: 'failed',
      ...(signal === undefined ? {} : { signal }),
    });
  }
  purgeOriginals(body: PurgeOriginalsRequest) {
    return this.transport.request({
      method: 'POST',
      path: MONEY_ORIGINALS_PURGE_PATH,
      body,
      schema: PurgeOriginalsResponseSchema,
      what: '清掉已记账的原图',
      lostAs: 'uncertain',
    });
  }
}
