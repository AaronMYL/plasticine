// /v2/lines… 和 /v2/model-providers… 的真实现（形状见 agent/shared/api/lines.ts、model-providers.ts）。
// 写操作都带 requestId：没拿到回答算「结果待核实」，由调用方决定要不要用同一个标识再发。

import type { LinesApi, ListLinesQuery, ModelProvidersApi, ReadLineQuery } from '../lines-client.ts';
import {
  CHATS_PATH,
  ChatsResponseSchema,
  ReactLineMessageResponseSchema,
  SIDE_PATH,
  lineReactionsPath,
  type OpenSideRequest,
  type ReactLineMessageRequest,
  AnswerLineWidgetResponseSchema,
  LINES_PATH,
  LineQueueResponseSchema,
  LineDetailsResponseSchema,
  LineResponseSchema,
  ListLinesResponseSchema,
  ListModelProvidersResponseSchema,
  MODEL_CONFIG_PATH,
  MODEL_DEFAULT_PATH,
  MODEL_PROVIDERS_PATH,
  ProviderLoginViewSchema,
  ReadLineResponseSchema,
  SendLineMessageResponseSchema,
  lineMessagesPath,
  linePath,
  lineQueuePath,
  lineWidgetsPath,
  modelProviderPath,
  providerLoginPath,
  type AnswerLineWidgetRequest,
  type LineCommandRequest,
  type LineDetailsQuery,
  type SaveModelConfigRequest,
  type SendLineMessageRequest,
  type SetDefaultModelRequest,
} from '../shared.ts';
import type { Transport } from './transport.ts';

export class HttpLines implements LinesApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  list(query: ListLinesQuery, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: LINES_PATH, query: { ...query },
      schema: ListLinesResponseSchema, what: '读线', lostAs: 'failed', signal });
  }

  read(lineId: string, query: ReadLineQuery, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: linePath(lineId), query: { ...query },
      schema: ReadLineResponseSchema, what: '读对话', lostAs: 'failed', signal });
  }

  details(lineId: string, query: LineDetailsQuery, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${linePath(lineId)}/details`, query: { ...query },
      schema: LineDetailsResponseSchema, what: '读工作详情', lostAs: 'failed', signal });
  }

  send(lineId: string, body: SendLineMessageRequest) {
    return this.transport.request({ method: 'POST', path: lineMessagesPath(lineId), body,
      schema: SendLineMessageResponseSchema, what: '发送', lostAs: 'uncertain' });
  }

  withdraw(lineId: string, queueId: string, body: LineCommandRequest) {
    return this.transport.request({ method: 'POST', path: `${lineQueuePath(lineId, queueId)}/withdraw`, body,
      schema: LineQueueResponseSchema, what: '撤回', lostAs: 'uncertain' });
  }

  sendNow(lineId: string, queueId: string, body: LineCommandRequest) {
    return this.transport.request({ method: 'POST', path: `${lineQueuePath(lineId, queueId)}/send-now`, body,
      schema: LineQueueResponseSchema, what: '立即发送', lostAs: 'uncertain' });
  }

  answerWidget(lineId: string, body: AnswerLineWidgetRequest) {
    return this.transport.request({ method: 'POST', path: lineWidgetsPath(lineId), body,
      schema: AnswerLineWidgetResponseSchema, what: '作答', lostAs: 'uncertain' });
  }

  pause(lineId: string, body: LineCommandRequest) {
    return this.command(lineId, 'pause', body, '暂停');
  }

  resume(lineId: string, body: LineCommandRequest) {
    return this.command(lineId, 'resume', body, '继续');
  }

  stop(lineId: string, body: LineCommandRequest) {
    return this.command(lineId, 'stop', body, '停止');
  }

  remove(lineId: string, body: LineCommandRequest) {
    return this.command(lineId, 'delete', body, '删除');
  }

  restore(lineId: string, body: LineCommandRequest) {
    return this.command(lineId, 'restore', body, '恢复');
  }

  private command(lineId: string, action: string, body: LineCommandRequest, what: string) {
    return this.transport.request({ method: 'POST', path: `${linePath(lineId)}/${action}`, body,
      schema: LineResponseSchema, what, lostAs: 'uncertain' });
  }

  react(lineId: string, body: ReactLineMessageRequest) {
    return this.transport.request({ method: 'POST', path: lineReactionsPath(lineId), body,
      schema: ReactLineMessageResponseSchema, what: '加表情', lostAs: 'uncertain' });
  }

  openSide(body: OpenSideRequest) {
    return this.transport.request({ method: 'POST', path: SIDE_PATH, body,
      schema: LineResponseSchema, what: '打开对话', lostAs: 'uncertain' });
  }

  chats(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: CHATS_PATH, schema: ChatsResponseSchema,
      what: '读取对话列表', lostAs: 'failed', signal });
  }
}

export class HttpModelProviders implements ModelProvidersApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  list(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: MODEL_PROVIDERS_PATH,
      schema: ListModelProvidersResponseSchema, what: '读模型连接', lostAs: 'failed', signal });
  }

  startLogin(providerId: string, requestId: string) {
    return this.transport.request({ method: 'POST', path: `${modelProviderPath(providerId)}/login`,
      body: { requestId }, schema: ProviderLoginViewSchema, what: '开始登录', lostAs: 'uncertain' });
  }

  login(providerId: string, loginId: string, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: providerLoginPath(providerId, loginId),
      schema: ProviderLoginViewSchema, what: '读登录进度', lostAs: 'failed', signal });
  }

  completeLogin(providerId: string, loginId: string, requestId: string, input: string) {
    return this.transport.request({ method: 'POST', path: `${providerLoginPath(providerId, loginId)}/complete`,
      body: { requestId, input }, schema: ProviderLoginViewSchema, what: '完成登录', lostAs: 'uncertain' });
  }

  cancelLogin(providerId: string, loginId: string, requestId: string) {
    return this.transport.request({ method: 'POST', path: `${providerLoginPath(providerId, loginId)}/cancel`,
      body: { requestId }, schema: ProviderLoginViewSchema, what: '取消登录', lostAs: 'uncertain' });
  }

  setKey(providerId: string, requestId: string, apiKey: string) {
    return this.transport.request({ method: 'POST', path: `${modelProviderPath(providerId)}/key`,
      body: { requestId, apiKey }, schema: ListModelProvidersResponseSchema, what: '保存 key', lostAs: 'uncertain' });
  }

  logout(providerId: string, requestId: string) {
    return this.transport.request({ method: 'POST', path: `${modelProviderPath(providerId)}/logout`,
      body: { requestId }, schema: ListModelProvidersResponseSchema, what: '断开', lostAs: 'uncertain' });
  }

  setDefault(body: SetDefaultModelRequest) {
    return this.transport.request({ method: 'POST', path: MODEL_DEFAULT_PATH, body,
      schema: ListModelProvidersResponseSchema, what: '选默认模型', lostAs: 'uncertain' });
  }

  saveConfig(body: SaveModelConfigRequest) {
    return this.transport.request({ method: 'POST', path: MODEL_CONFIG_PATH, body,
      schema: ListModelProvidersResponseSchema, what: '保存模型设置', lostAs: 'uncertain' });
  }
}
