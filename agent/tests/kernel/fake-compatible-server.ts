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
  override?: Record<string, [number, string]>;
  fail?: NodeJS.ErrnoException;
  reply?: string;
  rejectReasoning?: boolean;
  rejectImages?: boolean;
  contexts?: Record<string, number>;
}

function hasImage(body: unknown): boolean {
  return JSON.stringify(body).includes('"image_url"');
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
    const sent: unknown = typeof raw === 'string' ? JSON.parse(raw) as unknown : null;
    seen.push({ url, method: init?.method ?? 'GET', headers: headersOf(init), body: sent });
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
      return Response.json({ object: 'list', data: models.map((id) => ({ id, object: 'model',
        ...(options.contexts?.[id] === undefined ? {} : { context_length: options.contexts[id] }) })) });
    }
    if (path.endsWith('/chat/completions')) {
      const body = sent as { model?: unknown; reasoning_effort?: unknown } | null;
      const model = String(body?.model ?? '');
      if (options.rejectReasoning === true && body?.reasoning_effort !== undefined) {
        return Response.json({ error: { message: 'Unrecognized request argument supplied: reasoning_effort' } },
          { status: 400 });
      }
      if (options.rejectImages === true && hasImage(body)) {
        return Response.json({ error: { message: 'This model does not support image input' } }, { status: 400 });
      }
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
