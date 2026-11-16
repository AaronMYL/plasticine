// 不联网的「OpenAI 兼容接口」：一个假的 fetch，答 GET …/models 和 POST …/chat/completions（流式），
// 记下每次请求，好检查发出去的路径、头和正文。example.com 只是占位，不会真的去连。

export const FAKE_BASE = 'https://llm.example.com/v1';
export const FAKE_KEY = 'sk-fake-for-tests-0123456789';

export interface SeenRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeServerOptions {
  models?: string[];
  /** 换掉某个路径的回答：路径结尾 → [状态码, 正文]。 */
  override?: Record<string, [number, string]>;
  /** 连接层直接失败（模拟 DNS、拒绝连接）。 */
  fail?: NodeJS.ErrnoException;
  reply?: string;
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function sse(model: string, text: string): string {
  const chunk = (delta: object, finish: string | null): string => `data: ${JSON.stringify({ id: 'chatcmpl-test',
    object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return `${chunk({ role: 'assistant', content: text }, null)}${chunk({}, 'stop')}data: [DONE]\n\n`;
}

export function fakeCompatibleServer(options: FakeServerOptions = {}) {
  const seen: SeenRequest[] = [];
  const models = options.models ?? ['monk', 'monk-fast'];
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const raw = init?.body;
    seen.push({ url, method: init?.method ?? 'GET', headers: headersOf(init),
      body: typeof raw === 'string' ? JSON.parse(raw) as unknown : null });
    if (options.fail !== undefined) {
      throw new TypeError('fetch failed', { cause: options.fail });
    }
    const path = new URL(url).pathname;
    const override = Object.entries(options.override ?? {}).find(([end]) => path.endsWith(end));
    if (override !== undefined) {
      const [status, body] = override[1];
      return new Response(body, { status, headers: { 'content-type': body.startsWith('<')
        ? 'text/html' : 'application/json' } });
    }
    if (path.endsWith('/models')) {
      return Response.json({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) });
    }
    if (path.endsWith('/chat/completions')) {
      const model = String((seen.at(-1)?.body as { model?: unknown } | null)?.model ?? '');
      if (!models.includes(model)) {
        return Response.json({ error: { message: `The model \`${model}\` does not exist`, type: 'invalid_request' } },
          { status: 404 });
      }
      return new Response(sse(model, options.reply ?? 'pong'), { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch: fetcher, seen };
}
