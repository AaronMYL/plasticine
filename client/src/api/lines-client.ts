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
  ImageModelResponse,
  ListModelProvidersResponse,
  SaveCustomProviderRequest,
  TestModelConnectionRequest,
  TestModelConnectionResponse,
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
  read(lineId: string, query: ReadLineQuery, signal?: AbortSignal): Promise<ReadLineResponse>;
  details(lineId: string, query: LineDetailsQuery, signal?: AbortSignal): Promise<LineDetailsResponse>;
  send(lineId: string, body: SendLineMessageRequest): Promise<SendLineMessageResponse>;
  /** POST /v2/lines/:id/queue/:queueId/withdraw */
  withdraw(lineId: string, queueId: string, body: LineCommandRequest): Promise<LineQueueResponse>;
  sendNow(lineId: string, queueId: string, body: LineCommandRequest): Promise<LineQueueResponse>;
  answerWidget(lineId: string, body: AnswerLineWidgetRequest): Promise<AnswerLineWidgetResponse>;
  pause(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  resume(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  stop(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  remove(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  restore(lineId: string, body: LineCommandRequest): Promise<LineResponse>;
  react(lineId: string, body: ReactLineMessageRequest): Promise<ReactLineMessageResponse>;
  openSide(body: OpenSideRequest): Promise<{ line: LineView }>;
  chats(signal?: AbortSignal): Promise<ChatsResponse>;
}

export interface ModelProvidersApi {
  list(signal?: AbortSignal): Promise<ListModelProvidersResponse>;
  imageModel(signal?: AbortSignal): Promise<ImageModelResponse>;
  startLogin(providerId: string, requestId: string): Promise<ProviderLoginView>;
  login(providerId: string, loginId: string, signal?: AbortSignal): Promise<ProviderLoginView>;
  completeLogin(providerId: string, loginId: string, requestId: string, input: string): Promise<ProviderLoginView>;
  /** POST …/login/:loginId/cancel */
  cancelLogin(providerId: string, loginId: string, requestId: string): Promise<ProviderLoginView>;
  setKey(providerId: string, requestId: string, apiKey: string): Promise<ListModelProvidersResponse>;
  /** POST /v2/model-providers/:id/logout */
  logout(providerId: string, requestId: string): Promise<ListModelProvidersResponse>;
  /** POST /v2/model-default */
  setDefault(body: SetDefaultModelRequest): Promise<ListModelProvidersResponse>;
  saveConfig(body: SaveModelConfigRequest): Promise<ListModelProvidersResponse>;
  saveCustom(body: SaveCustomProviderRequest): Promise<ListModelProvidersResponse>;
  /** POST /v2/model-providers/custom/:id/remove */
  removeCustom(providerId: string, requestId: string): Promise<ListModelProvidersResponse>;
  testConnection(body: TestModelConnectionRequest): Promise<TestModelConnectionResponse>;
}
