// 新内核的两组接口（2026-11-05 Harness 重做）：线（/v2/lines…）和模型连接（/v2/model-providers…、/v2/model-default）。
// 形状都在 agent/shared/api/lines.ts、model-providers.ts；http/ 的真实现和 fake/ 的内存实现都满足这里。

import type {
  ChatsResponse,
  LineView,
  OpenSideRequest,
  ReactLineMessageRequest,
  ReactLineMessageResponse,
  AnswerLineWidgetRequest,
  AnswerLineWidgetResponse,
  LineCommandRequest,
  LineDetailsQuery,
  LineDetailsResponse,
  LineQueueResponse,
  LineResponse,
  ListLinesResponse,
  ListLinesQuery,
  ListModelProvidersResponse,
  ProviderLoginView,
  ReadLineResponse,
  SaveModelConfigRequest,
  SendLineMessageRequest,
  SendLineMessageResponse,
  SetDefaultModelRequest,
} from './shared.ts';
export type { ListLinesQuery } from './shared.ts';

export interface ReadLineQuery {
  before?: number;
  limit?: number;
}

export interface LinesApi {
  /** GET /v2/lines?kind=&limit= */
  list(query: ListLinesQuery, signal?: AbortSignal): Promise<ListLinesResponse>;
  /** GET /v2/lines/:id?before=&limit=：最新一页，消息从旧到新；id 写 main 就是主对话。 */
  read(lineId: string, query: ReadLineQuery, signal?: AbortSignal): Promise<ReadLineResponse>;
  /** GET /v2/lines/:id/details：完整成果、历史和核验过的请求来源。 */
  details(lineId: string, query: LineDetailsQuery, signal?: AbortSignal): Promise<LineDetailsResponse>;
  /** POST /v2/lines/:id/messages：空闲时开一轮，在跑时进排队。 */
  send(lineId: string, body: SendLineMessageRequest): Promise<SendLineMessageResponse>;
  /** POST /v2/lines/:id/queue/:queueId/withdraw */
  withdraw(lineId: string, queueId: string, body: LineCommandRequest): Promise<LineQueueResponse>;
  /** POST /v2/lines/:id/queue/:queueId/send-now：插进正在跑的这一轮。 */
  sendNow(lineId: string, queueId: string, body: LineCommandRequest): Promise<LineQueueResponse>;
  /** POST /v2/lines/:id/widgets：答回答下面的一个卡片小部件。 */
  answerWidget(lineId: string, body: AnswerLineWidgetRequest): Promise<AnswerLineWidgetResponse>;
  /** POST /v2/lines/:id/pause：停下，进度保留，能继续。 */
  pause(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  /** POST /v2/lines/:id/resume：暂停的、出错的接着做。 */
  resume(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  /** POST /v2/lines/:id/stop：不再继续，记录保留。 */
  stop(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  /** POST /v2/lines/:id/delete：移进最近删除（还在做的先停下）。 */
  remove(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  /** POST /v2/lines/:id/restore：从最近删除拿回来。 */
  restore(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  /** POST /v2/lines/:id/reactions：给一条消息加上或拿掉一个表情。 */
  react(lineId: string, body: ReactLineMessageRequest): Promise<ReactLineMessageResponse>;
  /** POST /v2/lines/side：开一条旁聊。 */
  openSide(body: OpenSideRequest): Promise<{ line: LineView }>;
  /** GET /v2/lines/chats：主线（带一行状态）和旁聊列表。 */
  chats(signal?: AbortSignal): Promise<ChatsResponse>;
}

export interface ModelProvidersApi {
  /** GET /v2/model-providers：平级的提供商列表、选的默认模型、实际在用的。 */
  list(signal?: AbortSignal): Promise<ListModelProvidersResponse>;
  /** POST /v2/model-providers/:id/login：开始订阅登录，回授权网址。 */
  startLogin(providerId: string, requestId: string): Promise<ProviderLoginView>;
  /** GET /v2/model-providers/:id/login/:loginId：登录走到哪了。 */
  login(providerId: string, loginId: string, signal?: AbortSignal): Promise<ProviderLoginView>;
  /** POST …/login/:loginId/complete：交浏览器跳转到的回调地址。 */
  completeLogin(providerId: string, loginId: string, requestId: string, input: string): Promise<ProviderLoginView>;
  /** POST …/login/:loginId/cancel */
  cancelLogin(providerId: string, loginId: string, requestId: string): Promise<ProviderLoginView>;
  /** POST /v2/model-providers/:id/key：密钥只写不读。 */
  setKey(providerId: string, requestId: string, apiKey: string): Promise<ListModelProvidersResponse>;
  /** POST /v2/model-providers/:id/logout */
  logout(providerId: string, requestId: string): Promise<ListModelProvidersResponse>;
  /** POST /v2/model-default */
  setDefault(body: SetDefaultModelRequest): Promise<ListModelProvidersResponse>;
  saveConfig(body: SaveModelConfigRequest): Promise<ListModelProvidersResponse>;
}
