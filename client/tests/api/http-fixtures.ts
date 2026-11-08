// 测真实现用的假 fetch、假 EventSource 和几条合 shared schema 的回答。

import type { EventSourceLike } from '../../src/api/http/events.ts';
import type { FetchLike, ResponseLike } from '../../src/api/http/transport.ts';
import type { LineMessageView, LineView, SendLineMessageResponse } from '../../src/api/shared.ts';
import type { AskView, NoteView } from '../../src/api/types.ts';

export const AT = '2026-10-27T02:00:00.000Z';
export const LATER = '2026-10-27T02:00:04.000Z';

export interface FetchCall {
  url: string;
  method: string;
  credentials: RequestCredentials | undefined;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

export type Responder = (call: FetchCall) => ResponseLike | Error | Promise<ResponseLike>;

export function json(status: number, body: unknown): ResponseLike {
  return { status, text: async () => JSON.stringify(body) };
}

export function text(status: number, body: string): ResponseLike {
  return { status, text: async () => body };
}

/** 按顺序回答；最后一个回答之后的请求都用最后一个。 */
export function fakeFetch(...responders: Responder[]): { fetch: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: FetchCall = {
      url,
      method: init.method ?? 'GET',
      credentials: init.credentials,
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    };
    calls.push(call);
    const responder = responders[Math.min(calls.length, responders.length) - 1];
    if (responder === undefined) {
      throw new Error('假 fetch 没有准备回答');
    }
    const answer = await responder(call);
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  return { fetch, calls };
}

/** 一直不回答，直到请求被中止（超时或调用方取消）。 */
export function hangs(call: FetchCall): Promise<ResponseLike> {
  return new Promise((_resolve, reject) => {
    call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

export function lineView(fields: Partial<LineView> = {}): LineView {
  return { id: 'line-main', kind: 'main', parentLineId: null, parentMessageSeq: null, projectId: null,
    title: '主对话', status: 'running',
    pauseReason: null, outcome: null,
    pausedUntil: null, failure: null, activity: null, activeSince: AT, queued: 0, lastAnswer: null, createdAt: AT,
    updatedAt: AT, ...fields };
}

export function lineMessage(fields: Partial<LineMessageView> = {}): LineMessageView {
  return { lineId: 'line-main', seq: 1, role: 'user', origin: { kind: 'user' }, text: '一句',
    thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], createdAt: AT, ...fields };
}

/** 发一句、线空闲时开了一轮的回答。 */
export function sentResponse(message = lineMessage()): SendLineMessageResponse {
  return { line: lineView(), outcome: 'started', message, queued: null };
}

export function noteView(fields: Partial<NoteView> = {}): NoteView {
  return {
    id: 'note_1',
    title: '计划',
    folder: '笔记',
    pinned: false,
    private: false,
    readOnly: false,
    author: 'user',
    preview: '第一段',
    bytes: 20,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    deletedAt: null,
    migrated: false,
    markdown: '# 计划\n\n第一段',
    ...fields,
  };
}

export function askView(fields: Partial<AskView> = {}): AskView {
  return {
    id: 'ask_1',
    kind: 'decide',
    kindLabel: '要你定',
    channel: 'popup',
    question: '有 3 笔对不上，先怎么处理？',
    detail: null,
    options: [
      { id: 'fix', label: '按流水改', recommended: true, description: null },
      { id: 'mark', label: '先标出来', recommended: false, description: null },
    ],
    layout: 'inline',
    status: 'open',
    answer: null,
    lineId: null,
    createdAt: AT,
    deferredAt: null,
    answeredAt: null,
    version: 1,
    ...fields,
  };
}

/** 假的 EventSource：测试推事件、造断线。 */
export class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly url: string;
  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  get types(): string[] {
    return [...this.listeners.keys()].sort();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  /** 推一条事件：data 不是字符串就按 JSON 写，和服务端的 `data:` 行一样。 */
  emit(type: string, data: unknown, id = ''): void {
    const event = new MessageEvent<string>(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId: id,
    });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  /** 断线：closed = true 是浏览器放弃了，否则是它正在自己重连。 */
  fail(closed: boolean): void {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event('error'));
  }
}

export function eventSources(): { create: (url: string) => FakeEventSource; created: FakeEventSource[] } {
  const created: FakeEventSource[] = [];
  return {
    created,
    create: (url) => {
      const source = new FakeEventSource(url);
      created.push(source);
      return source;
    },
  };
}
