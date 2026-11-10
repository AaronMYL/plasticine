import { afterEach, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import { xhrUpload } from '../../src/api/http/xhr-upload.ts';
import { Transport } from '../../src/api/http/transport.ts';

afterEach(() => vi.unstubAllGlobals());

it('真实上传路径报告已传输比例并响应取消，使用原JSON和同源会话', async () => {
  const calls: FakeXhr[] = [];
  class FakeXhr {
    status = 201;
    responseText = '{}';
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    headers = new Map<string, string>();
    body: unknown;
    method = '';
    url = '';
    aborted = false;
    constructor() { calls.push(this); }
    open(method: string, url: string) { this.method = method; this.url = url; }
    setRequestHeader(key: string, value: string) { this.headers.set(key, value); }
    send(body: unknown) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  const progress = vi.fn();
  const controller = new AbortController();
  const sending = xhrUpload('/v2/conversation/attachments', { method: 'POST', body: '{"content":"x"}',
    headers: { 'content-type': 'application/json' }, signal: controller.signal }, progress);
  const call = calls[0]!;
  call.upload.onprogress?.(new ProgressEvent('progress', { lengthComputable: true, loaded: 40, total: 100 }));
  expect(progress).toHaveBeenCalledWith(0.4);
  expect(call.body).toBe('{"content":"x"}');
  expect(call.headers.get('content-type')).toBe('application/json');
  controller.abort();
  await expect(sending).rejects.toMatchObject({ name: 'AbortError' });
  expect(call.aborted).toBe(true);
});

it('有进度的上传也使用Transport的错误分类；读取原件为Blob而非下载跳转', async () => {
  const unauthorized = vi.fn();
  const upload = vi.fn(async (_url, _init, onProgress) => {
    onProgress(0.5);
    return { status: 401, text: async () => JSON.stringify({ code: 'unauthorized', error: '请登录' }) };
  });
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  const fetch = vi.fn(async () => ({ status: 200, text: async () => '', blob: async () => blob }));
  const transport = new Transport({ fetch, upload, onUnauthorized: unauthorized });
  await expect(transport.request({ method: 'POST', path: '/v2/conversation/attachments', body: {},
    schema: Type.Object({}), what: '上传', lostAs: 'uncertain', onUploadProgress: vi.fn() }))
    .rejects.toMatchObject({ kind: 'unauthorized' });
  expect(unauthorized).toHaveBeenCalledOnce();
  expect(await transport.blob('/v2/conversation/attachments/example/content')).toBe(blob);
  expect(fetch).toHaveBeenCalledWith('/v2/conversation/attachments/example/content',
    expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
});
