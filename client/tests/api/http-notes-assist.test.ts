import { afterEach, expect, it, vi } from 'vitest';
import { createHttpApi } from '../../src/api/http/index.ts';
import type { ResponseLike } from '../../src/api/http/transport.ts';
import { eventSources, fakeFetch, hangs, json, text } from './http-fixtures.ts';

afterEach(() => { vi.useRealTimers(); });

it('全文修改保留长生成窗口，预测及时超时，两者都仍可取消', async () => {
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

it('选段请求保留明确前后文及自定义修改要求', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, { label: '按要求修改', markdown: '新选段' }));
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  const input = { action: 'custom' as const, markdown: '完整正文', selected: '原选段',
    before: '这段前面的背景', after: '这段后面的结论', instruction: '写得更清楚' };
  expect(await api.notes.assist('note_1', input)).toEqual({ label: '按要求修改', markdown: '新选段' });
  expect(calls[0]?.body).toEqual(input);
});

/** 一个 SSE 回答，故意在一条事件中间切开成几块到。 */
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

it('续写流式：带 stream 和 accept，增量一段段交出（含切在半个字中间的块），最后以 done 的最终文字为准', async () => {
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

it('续写流式：没有 body 的回答整段读完再拆；开始送之后失败是 error 事件，带服务端的文案', async () => {
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

it('续写流式：开始之前的错误照普通回答分类；断在 done 之前、事件格式不对都算回答格式不对', async () => {
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

it('续写流式：调用方取消照原样抛出，不算没拿到回答', async () => {
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
