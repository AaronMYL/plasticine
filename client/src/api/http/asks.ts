// /v2/asks 的真实现：现在摊开的一张和排队的、作答、先不、问一句。写操作都带 requestId，重发拿到同一个回答。

import type { AsksApi } from '../client.ts';
import {
  AnswerAskResponseSchema,
  AskAboutResponseSchema,
  AskListResponseSchema,
  ASKS_PATH,
  AskViewSchema,
  DeferAskResponseSchema,
} from '../shared.ts';
import type {
  AnswerAskRequest,
  AnswerAskResponse,
  AskAboutRequest,
  AskAboutResponse,
  AskListResponse,
  AskView,
  AskFeedbackRequest,
  DeferAskRequest,
  DeferAskResponse,
} from '../types.ts';
import type { Transport } from './transport.ts';

function askPath(id: string): string {
  return `${ASKS_PATH}/${encodeURIComponent(id)}`;
}

export class HttpAsks implements AsksApi {
  async feedback(id: string, input: AskFeedbackRequest): Promise<AskView> {
    return this.transport.request({ method: 'POST', path: `${askPath(id)}/feedback`, body: input,
      schema: AskViewSchema, what: '记录提问反馈', lostAs: 'uncertain' });
  }
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async list(signal?: AbortSignal): Promise<AskListResponse> {
    return this.transport.request({
      method: 'GET',
      path: ASKS_PATH,
      schema: AskListResponseSchema,
      what: '读要你定的卡',
      lostAs: 'failed',
      signal,
    });
  }

  async get(id: string, signal?: AbortSignal): Promise<AskView> {
    return this.transport.request({
      method: 'GET',
      path: askPath(id),
      schema: AskViewSchema,
      what: '读这张卡',
      lostAs: 'failed',
      signal,
    });
  }

  async answer(id: string, input: AnswerAskRequest): Promise<AnswerAskResponse> {
    return this.transport.request({
      method: 'POST',
      path: `${askPath(id)}/answer`,
      body: input,
      schema: AnswerAskResponseSchema,
      what: '作答',
      lostAs: 'uncertain',
    });
  }

  async defer(id: string, input: DeferAskRequest): Promise<DeferAskResponse> {
    return this.transport.request({
      method: 'POST',
      path: `${askPath(id)}/defer`,
      body: input,
      schema: DeferAskResponseSchema,
      what: '先不',
      lostAs: 'uncertain',
    });
  }

  async ask(id: string, input: AskAboutRequest): Promise<AskAboutResponse> {
    return this.transport.request({
      method: 'POST',
      path: `${askPath(id)}/ask`,
      body: input,
      schema: AskAboutResponseSchema,
      what: '问一句',
      lostAs: 'uncertain',
    });
  }
}
