// /v2/agreements 的真实现：约定栏往后翻、一条的详情。确认 / 撤由本人会话确认，走 signed.ts。

import type { AgreementsApi } from '../client.ts';
import {
  AGREEMENTS_PATH, AgreementDetailSchema, AgreementListResponseSchema, AgreementResponseSchema,
  TermDecodingListSchema, type CreateTermRequest, type ProposeTermRequest, type TermDecodingList,
  type AgreementView,
} from '../shared.ts';
import type { AgreementDetail, AgreementListQuery, AgreementListResponse } from '../types.ts';
import type { Transport } from './transport.ts';

export class HttpAgreements implements AgreementsApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async create(input: CreateTermRequest): Promise<AgreementView> {
    const result = await this.transport.request({ method: 'POST', path: AGREEMENTS_PATH, body: input,
      schema: AgreementResponseSchema, what: '保存新词', lostAs: 'uncertain' });
    return result.agreement;
  }

  async propose(id: string, input: ProposeTermRequest): Promise<AgreementView> {
    const result = await this.transport.request({
      method: 'PUT', path: `${AGREEMENTS_PATH}/${encodeURIComponent(id)}`, body: input,
      schema: AgreementResponseSchema, what: '保存词语提议', lostAs: 'uncertain',
    });
    return result.agreement;
  }

  decodings(id: string, signal?: AbortSignal): Promise<TermDecodingList> {
    return this.transport.request({
      method: 'GET', path: `${AGREEMENTS_PATH}/${encodeURIComponent(id)}/decodings`, signal,
      schema: TermDecodingListSchema, what: '读取词语解码', lostAs: 'failed',
    });
  }

  async list(query: AgreementListQuery, signal?: AbortSignal): Promise<AgreementListResponse> {
    return this.transport.request({
      method: 'GET',
      path: AGREEMENTS_PATH,
      query: { state: query.state, kind: query.kind, limit: query.limit, offset: query.offset },
      schema: AgreementListResponseSchema,
      what: '读约定',
      lostAs: 'failed',
      signal,
    });
  }

  async get(id: string, signal?: AbortSignal): Promise<AgreementDetail> {
    return this.transport.request({
      method: 'GET',
      path: `${AGREEMENTS_PATH}/${encodeURIComponent(id)}`,
      schema: AgreementDetailSchema,
      what: '读这条约定',
      lostAs: 'failed',
      signal,
    });
  }
}
