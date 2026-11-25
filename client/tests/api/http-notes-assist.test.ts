import { afterEach, expect, it, vi } from 'vitest';
import { createHttpApi } from '../../src/api/http/index.ts';
import type { ResponseLike } from '../../src/api/http/transport.ts';
import { eventSources, fakeFetch, hangs, json, text } from './http-fixtures.ts';

afterEach(() => { vi.useRealTimers(); });

it('Full-note edit keeps long window, prediction times out promptly, both cancelable', async () => {
  vi.useFakeTimers();
  const { fetch, calls } = fakeFetch(hangs);
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  const full = api.notes.assist('note_1', { action: 'polish', markdown: '全文' }).catch((error: unknown) => error);
  const predict = api.notes.assist('note_1', { action: 'predict', markdown: '光标前文' })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(calls[0]?.signal?.aborted).toBe(false);
  expect(calls[1]?.signal?.aborted).toBe(true);
  expect(await predict).toMatchObject({ code: 'network', message: '笔记建议：连接超时。' });
  await vi.advanceTimersByTimeAsync(95_000);
  expect(calls[0]?.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(calls[0]?.signal?.aborted).toBe(true);
  expect(await full).toMatchObject({ code: 'network', message: '笔记建议：连接超时。' });

  const controller = new AbortController();
  const canceled = api.notes.assist('note_1', { action: 'polish', markdown: '全文' }, controller.signal)
    .catch((error: unknown) => error);
  controller.abort();
  expect(calls[2]?.signal?.aborted).toBe(true);
  expect(await canceled).toMatchObject({ name: 'AbortError' });
});

it('Selection request preserves explicit surrounding context and custom prompt', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, { label: '按要求修改', markdown: '新选段' }));
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  const input = { action: 'custom' as const, markdown: '完整正文', selected: '原选段',
    before: '这段前面的背景', after: '这段后面的结论', instruction: '写得更清楚' };
  expect(await api.notes.assist('note_1', input)).toEqual({ label: '按要求修改', markdown: '新选段' });
  expect(calls[0]?.body).toEqual(input);
});

function eventStream(frames: unknown[], cut = 7): ResponseLike {
  const text = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let start = 0; start < bytes.length; start += cut) {
        controller.enqueue(bytes.slice(start, start + cut));
      }
      controller.close();
    },
  });
  return { status: 200, text: async () => text, body };
}

it('Streaming continuation emits split UTF-8 deltas and finalizes with done text', async () => {
  const frames = [{ type: 'text', delta: '，然后' }, { type: 'text', delta: '把事实记清楚。' },
    { type: 'done', view: { label: '续写', markdown: '，然后把事实记清楚。' } }];
  const { fetch, calls } = fakeFetch(() => eventStream(frames));
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  const deltas: string[] = [];
  const view = await api.notes.assistStream('note_1', { action: 'predict', markdown: '前文', before: '前文' },
    (delta) => deltas.push(delta));
  expect(view).toEqual({ label: '续写', markdown: '，然后把事实记清楚。' });
  expect(deltas).toEqual(['，然后', '把事实记清楚。']);
  expect(calls[0]?.body).toEqual({ action: 'predict', markdown: '前文', before: '前文', stream: true });
  expect(calls[0]?.headers['accept']).toBe('text/event-stream');
});

it('Bodyless stream parses full text; mid-stream failure emits error with server msg', async () => {
  const done = { type: 'done', view: { label: '续写', markdown: '，接着写。' } };
  const failure = { type: 'error', error: { error: '服务出错了，这次操作不确定有没有完成。', code: 'internal_error' } };
  const { fetch } = fakeFetch(() => text(200, `data: ${JSON.stringify(done)}\n\n`),
    () => text(200, `data: ${JSON.stringify({ type: 'text', delta: '，先' })}\n\ndata: ${JSON.stringify(failure)}\n\n`));
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  expect(await api.notes.assistStream('note_1', { action: 'predict', markdown: '前文' }, () => undefined))
    .toEqual({ label: '续写', markdown: '，接着写。' });
  const deltas: string[] = [];
  const error = await api.notes.assistStream('note_1', { action: 'predict', markdown: '前文' },
    (delta) => deltas.push(delta)).catch((cause: unknown) => cause);
  expect(deltas).toEqual(['，先']);
  expect(error).toMatchObject({ kind: 'failed', code: 'internal_error', message: '服务出错了，这次操作不确定有没有完成。' });
});

it('Pre-stream errors classify normally; early EOF or bad event fails as format error', async () => {
  const { fetch } = fakeFetch(() => json(500, { error: '服务出错了，这次操作不确定有没有完成。', code: 'internal_error' }),
    () => text(200, `data: ${JSON.stringify({ type: 'text', delta: '，先' })}\n\n`),
    () => text(200, 'data: {"type":"text"}\n\n'));
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  const input = { action: 'predict' as const, markdown: '前文' };
  expect(await api.notes.assistStream('note_1', input, () => undefined).catch((cause: unknown) => cause))
    .toMatchObject({ kind: 'failed', code: 'internal_error' });
  expect(await api.notes.assistStream('note_1', input, () => undefined).catch((cause: unknown) => cause))
    .toMatchObject({ code: 'bad_response' });
  expect(await api.notes.assistStream('note_1', input, () => undefined).catch((cause: unknown) => cause))
    .toMatchObject({ code: 'bad_response' });
});

it('Caller-aborted stream rethrows as-is without treating as missing response', async () => {
  const { fetch, calls } = fakeFetch(hangs);
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  const controller = new AbortController();
  const pending = api.notes.assistStream('note_1', { action: 'predict', markdown: '前文' }, () => undefined,
    controller.signal).catch((error: unknown) => error);
  await Promise.resolve();
  controller.abort();
  expect(calls[0]?.signal?.aborted).toBe(true);
  expect(await pending).toMatchObject({ name: 'AbortError' });
});
