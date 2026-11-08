// 网页翻译接口的真实现（2026-11-04 修「翻译 开 → 关 → 再开 不翻了」）：一批的时限比服务端问模型的时限长；
// 关掉翻译时调用方取消，请求当场中止。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATE_MODEL_TIMEOUT_MS, TRANSLATE_PATH } from '../../src/api/shared.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import { TRANSLATE_REQUEST_TIMEOUT_MS } from '../../src/api/http/translate.ts';
import { eventSources, fakeFetch, hangs } from './http-fixtures.ts';

afterEach(() => {
  vi.useRealTimers();
});

const BODY = { pageUrl: 'https://field-notes.dev/a', target: 'zh-CN' as const, priority: 'visible' as const,
  items: [{ id: 'x-1', text: 'Remember decisions, not transcripts' }] };

describe('网页翻译接口 · 真实现', () => {
  it('一批等得比服务端问模型的 60 秒更久：60 秒时还连着，过了时限才算没译成', async () => {
    expect(TRANSLATE_REQUEST_TIMEOUT_MS).toBeGreaterThan(TRANSLATE_MODEL_TIMEOUT_MS);
    vi.useFakeTimers();
    const { fetch, calls } = fakeFetch(hangs);
    const api = createHttpApi({ fetch, createEventSource: eventSources().create });
    const pending = api.translate.translate(BODY).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(TRANSLATE_MODEL_TIMEOUT_MS);
    expect(calls[0]?.url).toBe(TRANSLATE_PATH);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(TRANSLATE_REQUEST_TIMEOUT_MS - TRANSLATE_MODEL_TIMEOUT_MS);
    expect(await pending).toMatchObject({ kind: 'failed', code: 'network' });
  });

  it('关掉翻译时调用方取消：请求当场中止，不当成没译成', async () => {
    const { fetch, calls } = fakeFetch(hangs);
    const api = createHttpApi({ fetch, createEventSource: eventSources().create });
    const controller = new AbortController();
    const pending = api.translate.translate(BODY, controller.signal).catch((error: unknown) => error);
    await Promise.resolve();
    controller.abort();
    const error = await pending;
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(error).toMatchObject({ name: 'AbortError' });
  });
});
