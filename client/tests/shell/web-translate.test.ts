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
    // 假的服务端不理会取消：上一轮在路上的永远不回，正好看并发是不是只算当前这一轮。
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
    newRun: () => { runs += 1; return `run-${runs}`; } });
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

describe('网页界面这一头的翻译', () => {
  it('点开：告诉原生开哪一轮；段落来了调翻译接口、译文送回去；都回来了按钮变成开着，首屏毫秒数记进度量', async () => {
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

  it('同时最多三批在路上；空出来的位置先给他正看着的段落，再给下一屏的预取', async () => {
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

  it('额度用完：没译成的段落告诉原生、按钮出错并带原因；模型忙就过一会儿自己再要一次', async () => {
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

  it('关掉：在路上的请求当场取消；再开不用等上一轮让位，马上要，译文回来马上送回', async () => {
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

  it('换目标语言重来一轮：上一轮在路上的也取消，别的标签在路上的不动', async () => {
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

  it('三种状态：在译 · 都译完 · 有段落没译成；点重试清掉原因、告诉原生同一轮再来，重试成功后是都译完', async () => {
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

  it('页内点了一段的重试、那段译成了：原因跟着清掉', async () => {
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

  it('付款类页面：按钮不能翻，点了也不开；总是翻译的网站一报到就开翻，换到别的网站就关掉', async () => {
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

  it('菜单：换显示方式就地切换；总是翻译这个网站打开就开翻；不翻译这个网站全部关掉并从总是翻译里拿掉', async () => {
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

  it('问这一段交给对话框；格式不对的事件不认', () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.translator.receive({ type: 'ask', tabId: 'web:1', url: URL_A, title: 'Field Notes', source: 'Hello',
      translation: '你好' });
    expect(t.asked).toEqual([{ url: URL_A, title: 'Field Notes', source: 'Hello', translation: '你好' }]);
    t.translator.receive({ type: 'request', tabId: 'web:1' });
    expect(warn).toHaveBeenCalled();
  });
});
