import { describe, expect, it, vi } from 'vitest';
import type { TranslateApi } from '../../src/api/client.ts';
import type {
  PlasticineMacTranslate, TranslateRequest, TranslateResponse, TranslateSettingsView,
} from '../../src/api/shared.ts';
import { WebTranslator } from '../../src/shell/web-translate.ts';
import { Telemetry, type TelemetryRecord } from '../../src/telemetry.ts';

const URL_A = 'https://field-notes.dev/agents/what-to-remember';

interface Pending {
  body: TranslateRequest;
  signal: AbortSignal | undefined;
  resolve: (response: TranslateResponse) => void;
  reject: (cause: unknown) => void;
}

function setup(alwaysSites: string[] = []) {
  let settings: TranslateSettingsView = { version: 1, target: 'zh-CN', display: 'bilingual', glossary: true,
    alwaysSites };
  const calls: Pending[] = [];
  const api: TranslateApi = {
    translate: (body, signal) => new Promise((resolve, reject) => calls.push({ body, signal, resolve, reject })),
    settings: async () => settings,
    saveSettings: async (body) => {
      settings = { ...body, version: body.version + 1 };
      return settings;
    },
    model: async () => ({ version: 0, chosen: null,
      effective: { provider: 'openai', model: 'gpt-6-luna', thinking: 'low' as const } }),
    saveModel: async () => { throw new Error('不用'); },
  };
  const bridge = { configure: vi.fn(), deliver: vi.fn() } satisfies PlasticineMacTranslate;
  const records: TelemetryRecord[] = [];
  const later: (() => void)[] = [];
  const asked: unknown[] = [];
  let runs = 0;
  const translator = new WebTranslator({ api, bridge, telemetry: new Telemetry((record) => records.push(record), true),
    ask: (quote) => asked.push(quote), schedule: (callback) => later.push(callback),
    newRun: () => {
      runs += 1;
      return `run-${runs}`;
    } });
  return { translator, calls, bridge, records, later, asked, settings: () => settings };
}

function request(tabId: string, run: string, ids: string[], priority: 'visible' | 'ahead' = 'visible') {
  return { type: 'request', tabId, run, url: URL_A, priority, fresh: false,
    items: ids.map((id) => ({ id, text: `Text of ${id}` })) };
}

function reply(pending: Pending, failure: TranslateResponse['failure'] = null): void {
  const failed = new Set(failure?.ids ?? []);
  pending.resolve({ model: 'gpt-6-luna', failure, items: pending.body.items.filter((item) => !failed.has(item.id))
    .map((item) => ({ id: item.id, text: `译：${item.text}`, cached: item.id.endsWith('c') })) });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function progress(tabId: string, run: string, counts: { pending: number; done: number; failed: number }) {
  return { type: 'progress', tabId, run, ...counts, chars: 40, firstScreenMs: null };
}

describe('client-side web translation controller', () => {
  it('enabling starts round, translates batches via API, updates active state and first-screen ms', async () => {
    const t = setup();
    await t.translator.refresh();
    t.translator.toggle('web:1', URL_A);
    expect(t.bridge.configure).toHaveBeenLastCalledWith('web:1',
      { run: 'run-1', target: 'zh-CN', display: 'bilingual' });
    expect(t.translator.state('web:1').status).toBe('running');
    t.translator.receive(request('web:1', 'run-1', ['a', 'bc']));
    expect(t.calls[0]?.body).toEqual({ pageUrl: URL_A, target: 'zh-CN', priority: 'visible',
      items: [{ id: 'a', text: 'Text of a' }, { id: 'bc', text: 'Text of bc' }] });
    reply(t.calls[0]!);
    await flush();
    expect(t.bridge.deliver).toHaveBeenCalledWith('web:1', { run: 'run-1', failed: [],
      items: [{ id: 'a', text: '译：Text of a' }, { id: 'bc', text: '译：Text of bc' }] });
    t.translator.receive({ type: 'progress', tabId: 'web:1', run: 'run-1', pending: 0, done: 2, failed: 0,
      chars: 19, firstScreenMs: 1_400 });
    expect(t.translator.state('web:1')).toMatchObject({ status: 'on', firstScreenMs: 1_400, cachedChars: 10 });
    expect(t.records.map((record) => [record.name, record.payload])).toEqual([
      ['translate.first_screen', { ms: 1_400, chars: 19 }],
      ['translate.page', { chars: 19, done: 2, failed: 0, cachedChars: 10 }],
    ]);
    expect(t.translator.model.get()).toBe('gpt-6-luna · low');
    t.translator.toggle('web:1', URL_A);
    expect(t.bridge.configure).toHaveBeenLastCalledWith('web:1', null);
    expect(t.translator.state('web:1').status).toBe('off');
  });

  it('caps in-flight batches at 3, prioritizing visible paragraphs before ahead prefetch', async () => {
    const t = setup();
    t.translator.start('web:1', URL_A);
    for (const id of ['v1', 'v2', 'v3']) {
      t.translator.receive(request('web:1', 'run-1', [id]));
    }
    t.translator.receive(request('web:1', 'run-1', ['a1'], 'ahead'));
    t.translator.receive(request('web:1', 'run-1', ['v4']));
    expect(t.calls.map((call) => call.body.items[0]?.id)).toEqual(['v1', 'v2', 'v3']);
    reply(t.calls[0]!);
    await flush();
    reply(t.calls[1]!);
    await flush();
    expect(t.calls.map((call) => call.body.items[0]?.id)).toEqual(['v1', 'v2', 'v3', 'v4', 'a1']);
  });

  it('quota exhaustion marks failed blocks with error reason; busy model retries automatically', async () => {
    const t = setup();
    t.translator.start('web:1', URL_A);
    t.translator.receive(request('web:1', 'run-1', ['a', 'b']));
    reply(t.calls[0]!, { code: 'busy', message: '模型服务这会儿忙，稍后再试。', retryAt: null, retryable: true,
      ids: ['b'] });
    await flush();
    expect(t.later).toHaveLength(1);
    t.later[0]!();
    expect(t.calls[1]?.body.items).toEqual([{ id: 'b', text: 'Text of b' }]);
    reply(t.calls[1]!, { code: 'quota', message: '订阅额度用完了，14:00 重置后能再试。',
      retryAt: '2026-11-03T06:00:00.000Z', retryable: false, ids: ['b'] });
    await flush();
    expect(t.bridge.deliver).toHaveBeenLastCalledWith('web:1', { run: 'run-1', items: [], failed: ['b'] });
    expect(t.translator.state('web:1')).toMatchObject({ status: 'error', reason: '订阅额度用完了，14:00 重置后能再试。' });
  });

  it('disabling aborts in-flight requests; re-enabling immediately dispatches without waiting', async () => {
    const t = setup();
    t.translator.start('web:1', URL_A);
    for (const id of ['v1', 'v2', 'v3']) {
      t.translator.receive(request('web:1', 'run-1', [id]));
    }
    expect(t.calls.map((call) => call.signal?.aborted)).toEqual([false, false, false]);
    t.translator.stop('web:1');
    expect(t.calls.map((call) => call.signal?.aborted)).toEqual([true, true, true]);
    t.translator.start('web:1', URL_A);
    t.translator.receive(request('web:1', 'run-2', ['v1c']));
    expect(t.calls.map((call) => call.body.items[0]?.id)).toEqual(['v1', 'v2', 'v3', 'v1c']);
    expect(t.calls[3]?.signal?.aborted).toBe(false);
    reply(t.calls[3]!);
    t.calls[0]!.reject(new DOMException('aborted', 'AbortError'));
    await flush();
    expect(t.bridge.deliver).toHaveBeenCalledTimes(1);
    expect(t.bridge.deliver).toHaveBeenLastCalledWith('web:1', { run: 'run-2', failed: [],
      items: [{ id: 'v1c', text: '译：Text of v1c' }] });
    expect(t.translator.state('web:1')).toMatchObject({ status: 'running', reason: null, cachedChars: 11 });
  });

  it('changing target language aborts prior round without affecting other tabs', async () => {
    const t = setup();
    await t.translator.refresh();
    t.translator.start('web:1', URL_A);
    t.translator.start('web:2', URL_A);
    t.translator.receive(request('web:1', 'run-1', ['a']));
    t.translator.receive(request('web:2', 'run-2', ['b']));
    t.translator.stop('web:2');
    await t.translator.setTarget('ja');
    expect(t.calls.map((call) => call.signal?.aborted)).toEqual([true, true]);
    expect(t.translator.state('web:1').run).toBe('run-3');
    t.translator.start('web:2', URL_A);
    t.translator.receive(request('web:2', 'run-4', ['c']));
    await t.translator.setDisplay('translation');
    expect(t.calls[2]?.signal?.aborted).toBe(false);
  });

  it('tracks translating/done/partial-error states; retry clears error and finishes round', async () => {
    const t = setup();
    t.translator.start('web:1', URL_A);
    t.translator.receive(progress('web:1', 'run-1', { pending: 2, done: 0, failed: 0 }));
    expect(t.translator.state('web:1').status).toBe('running');
    t.translator.receive(request('web:1', 'run-1', ['a', 'b']));
    reply(t.calls[0]!, { code: 'quota', message: '订阅额度用完了，14:00 重置后能再试。',
      retryAt: '2026-11-03T06:00:00.000Z', retryable: false, ids: ['b'] });
    await flush();
    t.translator.receive(progress('web:1', 'run-1', { pending: 0, done: 1, failed: 1 }));
    expect(t.translator.state('web:1')).toMatchObject({ status: 'error', failed: 1,
      reason: '订阅额度用完了，14:00 重置后能再试。' });
    t.bridge.configure.mockClear();
    t.translator.retry('web:1');
    expect(t.bridge.configure).toHaveBeenCalledWith('web:1', { run: 'run-1', target: 'zh-CN', display: 'bilingual' });
    expect(t.translator.state('web:1')).toMatchObject({ status: 'running', reason: null });
    t.translator.receive(progress('web:1', 'run-1', { pending: 1, done: 1, failed: 0 }));
    t.translator.receive(request('web:1', 'run-1', ['b']));
    reply(t.calls[1]!);
    await flush();
    t.translator.receive(progress('web:1', 'run-1', { pending: 0, done: 2, failed: 0 }));
    expect(t.translator.state('web:1')).toMatchObject({ status: 'on', reason: null, failed: 0 });
  });

  it('in-page single-block retry clears toolbar error once block succeeds', async () => {
    const t = setup();
    t.translator.start('web:1', URL_A);
    t.translator.receive(request('web:1', 'run-1', ['a']));
    reply(t.calls[0]!, { code: 'quota', message: '订阅额度用完了。', retryAt: null, retryable: false, ids: ['a'] });
    await flush();
    t.translator.receive(progress('web:1', 'run-1', { pending: 0, done: 0, failed: 1 }));
    t.translator.receive(progress('web:1', 'run-1', { pending: 1, done: 0, failed: 0 }));
    expect(t.translator.state('web:1').status).toBe('running');
    t.translator.receive(progress('web:1', 'run-1', { pending: 0, done: 1, failed: 0 }));
    expect(t.translator.state('web:1')).toMatchObject({ status: 'on', reason: null });
  });

  it('payment page disables button; always-translate auto-enables on site and disables off-site', async () => {
    const t = setup(['field-notes.dev']);
    await t.translator.refresh();
    t.translator.receive({ type: 'page', tabId: 'web:2', url: 'https://shop.example.com/checkout', blocked: true });
    t.translator.toggle('web:2', 'https://shop.example.com/checkout');
    expect(t.translator.state('web:2').status).toBe('blocked');
    expect(t.bridge.configure).not.toHaveBeenCalled();
    t.translator.receive({ type: 'page', tabId: 'web:1', url: URL_A, blocked: false });
    expect(t.translator.state('web:1').status).toBe('running');
    t.translator.receive({ type: 'page', tabId: 'web:1', url: 'https://field-notes.dev/next', blocked: false });
    expect(t.translator.state('web:1').run).toBe('run-1');
    t.translator.receive({ type: 'page', tabId: 'web:1', url: 'https://example.org/', blocked: false });
    expect(t.translator.state('web:1').status).toBe('off');
    expect(t.bridge.configure).toHaveBeenLastCalledWith('web:1', null);
  });

  it('menu toggles display mode, always-translate enables immediately, never-translate removes', async () => {
    const t = setup();
    await t.translator.refresh();
    await t.translator.setAlways('web:1', URL_A, true);
    expect(t.settings().alwaysSites).toEqual(['field-notes.dev']);
    expect(t.translator.state('web:1').run).toBe('run-1');
    await t.translator.setDisplay('translation');
    expect(t.bridge.configure).toHaveBeenLastCalledWith('web:1', { run: 'run-1', target: 'zh-CN',
      display: 'translation' });
    await t.translator.setTarget('ja');
    expect(t.bridge.configure).toHaveBeenLastCalledWith('web:1',
      { run: 'run-2', target: 'ja', display: 'translation' });
    await t.translator.never(URL_A);
    expect(t.settings().alwaysSites).toEqual([]);
    expect(t.translator.state('web:1').status).toBe('off');
    t.translator.receive(request('web:1', 'run-2', ['late']));
    expect(t.calls).toHaveLength(0);
  });

  it('ask-paragraph forwards to composer and ignores malformed events', () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.translator.receive({ type: 'ask', tabId: 'web:1', url: URL_A, title: 'Field Notes', source: 'Hello',
      translation: '你好' });
    expect(t.asked).toEqual([{ url: URL_A, title: 'Field Notes', source: 'Hello', translation: '你好' }]);
    t.translator.receive({ type: 'request', tabId: 'web:1' });
    expect(warn).toHaveBeenCalled();
  });
});
