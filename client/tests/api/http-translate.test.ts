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

describe('web translation API: real implementation', () => {
  it('batch waits past 60s server model timeout: still connected at 60s, fails only after timeout', async () => {
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

  it('caller aborts when translation closes: request aborts immediately without failing', async () => {
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
