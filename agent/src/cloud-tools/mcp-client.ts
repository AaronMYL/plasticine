import { CloudToolError } from './errors.ts';
import { checkPublicHttpsUrl } from './urls.ts';

const PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT_MS = 60_000;
const RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const LIST_PAGES_MAX = 20;

export interface McpTool {
  name: string;
  description: string;
  readOnly: boolean;
  inputSchema: unknown;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

type Fetch = typeof globalThis.fetch;

interface RpcMessage {
  id?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sseMessages(text: string): unknown[] {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    if (data === '') return [];
    try {
      return [JSON.parse(data) as unknown];
    } catch (cause) {
      if (cause instanceof SyntaxError) return [];
      throw cause;
    }
  });
}

export function toolsOf(result: unknown): { tools: McpTool[]; next: string | null } {
  const body = record(result);
  const list = Array.isArray(body['tools']) ? body['tools'] : [];
  const tools = list.flatMap((item): McpTool[] => {
    const tool = record(item);
    if (typeof tool['name'] !== 'string' || tool['name'] === '') return [];
    const annotations = record(tool['annotations']);
    return [{ name: tool['name'].slice(0, 128), description: typeof tool['description'] === 'string'
      ? tool['description'].slice(0, 1_000) : '', readOnly: annotations['readOnlyHint'] === true,
    inputSchema: tool['inputSchema'] ?? { type: 'object' } }];
  });
  return { tools, next: typeof body['nextCursor'] === 'string' ? body['nextCursor'] : null };
}

export function callText(result: unknown): McpCallResult {
  const body = record(result);
  const content = Array.isArray(body['content']) ? body['content'] : [];
  const text = content.map((item) => {
    const part = record(item);
    if (part['type'] === 'text' && typeof part['text'] === 'string') return part['text'];
    return `［${String(part['type'] ?? '内容')}］`;
  }).join('\n');
  const structured = body['structuredContent'] === undefined ? '' : JSON.stringify(body['structuredContent']);
  return { text: text === '' ? structured : text, isError: body['isError'] === true };
}

export class McpClient {
  readonly #url: URL;
  readonly #token: string | null;
  readonly #fetch: Fetch;
  #session: string | null = null;
  #next = 0;

  constructor(url: string, token: string | null, fetch: Fetch = globalThis.fetch, allowLocal = false) {
    this.#url = allowLocal ? new URL(url) : checkPublicHttpsUrl(url, 'url');
    this.#token = token;
    this.#fetch = fetch;
  }

  async #rpc(method: string, params: Record<string, unknown>, signal: AbortSignal, notify = false): Promise<unknown> {
    const id = notify ? undefined : ++this.#next;
    const headers: Record<string, string> = { 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL_VERSION };
    if (this.#token !== null) headers['authorization'] = `Bearer ${this.#token}`;
    if (this.#session !== null) headers['mcp-session-id'] = this.#session;
    let response: Response;
    try {
      response = await this.#fetch(this.#url, { method: 'POST', headers, redirect: 'error',
        body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id === undefined ? {} : { id }) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
    } catch (cause) {
      signal.throwIfAborted();
      throw new CloudToolError('unknown', `连不上这个服务（${cause instanceof Error ? cause.message : '网络错误'}）。`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudToolError('not_configured', '对方说没有权限：令牌不对或过期了，在设置里换一个。');
    }
    if (!response.ok && response.status !== 202) {
      throw new CloudToolError('failed', `这个服务回了 ${response.status}。`);
    }
    this.#session = response.headers.get('mcp-session-id') ?? this.#session;
    if (notify || response.status === 202) {
      return null;
    }
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > RESPONSE_MAX_BYTES) {
      throw new CloudToolError('failed', '这个服务回的东西太大了。');
    }
    const type = response.headers.get('content-type') ?? '';
    const messages = type.includes('text/event-stream') ? sseMessages(raw.toString('utf8'))
      : sseMessages(`data: ${raw.toString('utf8').replace(/\r?\n/g, ' ')}`);
    const answer = messages.map((message) => record(message) as RpcMessage).find((message) => message.id === id);
    if (answer === undefined) {
      throw new CloudToolError('failed', '这个服务没有回这一次的结果。');
    }
    if (answer.error !== undefined) {
      const message = typeof answer.error.message === 'string' ? answer.error.message.slice(0, 300) : '出错了';
      throw new CloudToolError('failed', `这个服务说：${message}`);
    }
    return answer.result;
  }

  async #initialize(signal: AbortSignal): Promise<void> {
    await this.#rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {},
      clientInfo: { name: 'Plasticine', version: '1' } }, signal);
    await this.#rpc('notifications/initialized', {}, signal, true);
  }

  async listTools(signal: AbortSignal): Promise<McpTool[]> {
    await this.#initialize(signal);
    const tools: McpTool[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < LIST_PAGES_MAX; page += 1) {
      const result = toolsOf(await this.#rpc('tools/list', cursor === null ? {} : { cursor }, signal));
      tools.push(...result.tools);
      cursor = result.next;
      if (cursor === null) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpCallResult> {
    await this.#initialize(signal);
    return callText(await this.#rpc('tools/call', { name, arguments: args }, signal));
  }
}
