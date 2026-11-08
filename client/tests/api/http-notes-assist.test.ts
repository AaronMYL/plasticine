import { afterEach, expect, it, vi } from 'vitest';
import { createHttpApi } from '../../src/api/http/index.ts';
import { eventSources, fakeFetch, hangs, json } from './http-fixtures.ts';

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
