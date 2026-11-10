// /v2/browser、/v2/tool-groups、/v2/notes/:id/versions 的真实现：浏览器页（画面是同源图片链接）、工具组列表（开关由本人会话确认）、
// 笔记的版本。浏览器的动作说不清做没做时服务端回 409 result_unknown，照通用分类带回（code 照服务端），界面给「核实」。

import { Value } from 'typebox/value';
import { ApiError } from '../errors.ts';
import type { BrowserApi, NoteVersionsApi, ToolGroupsApi } from '../m5b-client.ts';
import {
  WEB_EXTRACT_PATH, WEB_ARCHIVE_PATH, WebExtractViewSchema, WebArchiveViewSchema,
  type WebExtractInput, type WebExtractView, type WebArchiveRequest, type WebArchiveView,
  ACTIONS_PATH,
  ApiErrorSchema,
  BROWSER_ACTIONS_PATH,
  BROWSER_FRAME_PATH,
  BROWSER_OPEN_PATH,
  BROWSER_PATH,
  BROWSER_STREAM_PATH,
  BROWSER_ACK_PATH,
  BROWSER_TABS_PATH,
  BrowserAckResponseSchema,
  BrowserStreamEventSchema,
  type BrowserStreamQuery,
  type BrowserStreamEvent,
  type BrowserAck,
  type BrowserTabRequest,
  BrowserActionResponseSchema,
  BrowserResponseSchema,
  NOTES_PATH,
  NoteVersionListResponseSchema,
  NoteVersionTextSchema,
  SettleActionResponseSchema,
  TOOL_GROUPS_PATH,
  ToolGroupListResponseSchema,
  type BrowserActionRequest,
  type BrowserActionResponse,
  type BrowserViewDto,
  type NoteVersionListResponse,
  type NoteVersionText,
  type OpenBrowserRequest,
  type SettleActionRequest,
  type SettleActionResponse,
  type ToolGroupListResponse,
} from '../shared.ts';
import type { Transport } from './transport.ts';

// 打开一个页面要等云端浏览器加载完：30 秒（和服务端一样）。
const OPEN_TIMEOUT_MS = 35_000;

/**
 * 服务端说「做没做成说不清」（409 result_unknown）：这不是拒绝，是结果待核实——同一个标识不许换新的，界面给核实入口
 * （看画面后说做成了没有）。
 */
function resultUnknown(status: number, body: unknown): ApiError | undefined {
  if (status !== 409 || !Value.Check(ApiErrorSchema, body) || body.code !== 'result_unknown') {
    return undefined;
  }
  return new ApiError({ kind: 'uncertain', code: 'result_unknown', message: body.error, next: body.next, status });
}

export class HttpBrowser implements BrowserApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  extract(input: WebExtractInput, signal?: AbortSignal): Promise<WebExtractView> {
    return this.transport.request({ method: 'POST', path: WEB_EXTRACT_PATH, body: input,
      schema: WebExtractViewSchema, signal, timeoutMs: 125_000, what: '提取网页重点', lostAs: 'failed' });
  }
  archive(input: WebArchiveRequest, signal?: AbortSignal): Promise<WebArchiveView> {
    return this.transport.request({ method: 'POST', path: WEB_ARCHIVE_PATH, body: input,
      schema: WebArchiveViewSchema, signal, timeoutMs: 125_000, what: '归档网页', lostAs: 'uncertain' });
  }

  stream(query: BrowserStreamQuery, event: (event: BrowserStreamEvent) => void, error: () => void): () => void {
    const params = new URLSearchParams({ streamId: query.streamId,
      width: String(query.width), height: String(query.height),
      deviceScaleFactor: String(query.deviceScaleFactor ?? 1) });
    const source = new EventSource(`${BROWSER_STREAM_PATH}?${params}`);
    source.onmessage = (message) => {
      try {
        const value: unknown = JSON.parse(String(message.data));
        if (!Value.Check(BrowserStreamEventSchema, value)) {
          source.close();
          error();
          return;
        }
        event(value);
        if (value.type === 'unavailable') {
          source.close();
        }
      } catch {
        source.close();
        error();
      }
    };
    source.onerror = error;
    return () => source.close();
  }

  async ack(input: BrowserAck): Promise<void> {
    await this.transport.request({ method: 'POST', path: BROWSER_ACK_PATH, body: input,
      schema: BrowserAckResponseSchema, what: '确认画面', lostAs: 'failed' });
  }

  async tab(input: BrowserTabRequest): Promise<BrowserViewDto> {
    const result = await this.transport.request({ method: 'POST', path: BROWSER_TABS_PATH, body: input,
      schema: BrowserResponseSchema, what: '操作标签页', lostAs: 'uncertain' });
    return result.browser;
  }

  async get(signal?: AbortSignal): Promise<BrowserViewDto> {
    const response = await this.transport.request({
      method: 'GET',
      path: BROWSER_PATH,
      schema: BrowserResponseSchema,
      what: '读浏览器',
      lostAs: 'failed',
      signal,
    });
    return response.browser;
  }

  frameUrl(at: number): string {
    return `${BROWSER_FRAME_PATH}?at=${at}`;
  }

  async open(input: OpenBrowserRequest): Promise<BrowserViewDto> {
    const response = await this.transport.request({
      method: 'POST',
      path: BROWSER_OPEN_PATH,
      body: input,
      schema: BrowserResponseSchema,
      what: '打开网址',
      lostAs: 'failed',
      timeoutMs: OPEN_TIMEOUT_MS,
    });
    return response.browser;
  }

  act(input: BrowserActionRequest): Promise<BrowserActionResponse> {
    return this.transport.request({
      method: 'POST',
      path: BROWSER_ACTIONS_PATH,
      body: input,
      schema: BrowserActionResponseSchema,
      what: '浏览器操作',
      lostAs: 'uncertain',
      refine: resultUnknown,
    });
  }

  settle(requestId: string, input: SettleActionRequest): Promise<SettleActionResponse> {
    return this.transport.request({
      method: 'POST',
      path: `${ACTIONS_PATH}/${encodeURIComponent(requestId)}/settle`,
      body: input,
      schema: SettleActionResponseSchema,
      what: '核实',
      lostAs: 'uncertain',
    });
  }
}

export class HttpToolGroups implements ToolGroupsApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  list(signal?: AbortSignal): Promise<ToolGroupListResponse> {
    return this.transport.request({
      method: 'GET',
      path: TOOL_GROUPS_PATH,
      schema: ToolGroupListResponseSchema,
      what: '读工具组',
      lostAs: 'failed',
      signal,
    });
  }
}

export class HttpNoteVersions implements NoteVersionsApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  versions(noteId: string, signal?: AbortSignal): Promise<NoteVersionListResponse> {
    return this.transport.request({
      method: 'GET',
      path: `${NOTES_PATH}/${encodeURIComponent(noteId)}/versions`,
      schema: NoteVersionListResponseSchema,
      what: '读笔记版本',
      lostAs: 'failed',
      signal,
    });
  }

  version(noteId: string, version: number, signal?: AbortSignal): Promise<NoteVersionText> {
    return this.transport.request({
      method: 'GET',
      path: `${NOTES_PATH}/${encodeURIComponent(noteId)}/versions/${version}`,
      schema: NoteVersionTextSchema,
      what: '读这一版',
      lostAs: 'failed',
      signal,
    });
  }
}
