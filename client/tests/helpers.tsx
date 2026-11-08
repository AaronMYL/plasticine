// 测试用的工厂：一个装好假接口的整个应用，和几样 jsdom 没有的东西（布局尺寸）。

import { act, render, type RenderResult } from '@testing-library/react';
import { FakePushDevice } from '../src/api/fake/fake-push-device.ts';
import { createFakeApi, type FakeApi } from '../src/api/fake/index.ts';
import { MAIN_LINE_ID } from '../src/api/fake/fake-lines.ts';
import type { KeyValueStorage } from '../src/state/outbox.ts';
import type { NoteSeed } from '../src/api/fake/fake-notes.ts';
import { App } from '../src/app.tsx';
import { preloadLazyViews } from '../src/shell/lazy-view.ts';
import { createClientState, type ClientState } from '../src/state/context.tsx';
import { memorySink, Telemetry, type TelemetryRecord } from '../src/telemetry.ts';

export const NOW = new Date('2026-10-27T10:00:00+08:00');

/** 首页的页头（2026-11-05 起是日期问候一行「11月5日 星期四 早上好，Alex」，不再是「首页」两个字）。 */
export const HOME_HEADING = /^\d+月\d+日 星期./;

export interface AppHarness extends FakeApi {
  state: ClientState;
  records: TelemetryRecord[];
  view: RenderResult;
  pushDevice: FakePushDevice;
}

export interface AppOptions {
  seed?: boolean;
  now?: () => Date;
  width?: number;
  hash?: string;
  signedIn?: boolean;
  setup?: (fake: FakeApi) => void;
  /** 给了就用它（例如带着 sessionStorage 的假实现），不给就只在内存里。 */
  storage?: KeyValueStorage | null;
  pushDevice?: FakePushDevice;
  /** 先连上一家模型（默认连上；false 时一家都没连，进门先是「连接模型」）。 */
  modelConnected?: boolean;
}

export function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

/** 对话记录这类滚动区域在 jsdom 里没有高度：给它们一个，滚动规则才测得出来。 */
export const LIST_SCROLL_HEIGHT = 2000;
export const LIST_CLIENT_HEIGHT = 400;

export function fakeScrollableLists(): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('conv-list') || this.classList.contains('line-scroll') ? LIST_SCROLL_HEIGHT : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('conv-list') || this.classList.contains('line-scroll') ? LIST_CLIENT_HEIGHT : 0;
    },
  });
}

export async function renderApp(options: AppOptions = {}): Promise<AppHarness> {
  setViewportWidth(options.width ?? 1440);
  window.location.hash = options.hash ?? '#/today';
  const fake = createFakeApi({ seed: options.seed ?? false, streamStepMs: 0, now: options.now ?? (() => NOW) });
  if (options.signedIn ?? true) {
    fake.control.session.signInForDevelopment('测试机');
  }
  if (options.modelConnected ?? true) {
    fake.control.modelProviders.seedConnected([['openai', 'oauth']],
      { provider: 'openai', model: 'gpt-5.5', thinking: 'high' });
  }
  options.setup?.(fake);
  const state = createClientState({ storage: options.storage ?? null, now: options.now ?? (() => NOW) });
  const records: TelemetryRecord[] = [];
  const telemetry = new Telemetry(memorySink(records), true, () => NOW);
  const pushDevice = options.pushDevice ?? new FakePushDevice();
  // 按路由懒加载的视图先读进来：测试里切页和静态导入一样同步，不用到处等「正在读…」。
  await preloadLazyViews();
  let view: RenderResult | undefined;
  await act(async () => {
    view = render(<App api={fake.api} state={state} telemetry={telemetry} pushDevice={pushDevice} />);
  });
  if (view === undefined) {
    throw new Error('应用没有渲染出来');
  }
  return { ...fake, state, records, view, pushDevice };
}

/** sessionStorage 的内存替身：测「刷新这个标签页之后还在」。 */
export function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** 在主对话那条线里直接放一句（不跑剧本）：他说的是 user，Plasticine 的回答是 assistant。 */
export function sayInMain(fake: FakeApi, role: 'user' | 'assistant', text: string): void {
  fake.control.lines.record(MAIN_LINE_ID, { role, text, thinking: null, thinkingMs: null, steps: [],
    toolCallId: null, tool: null, say: null, ok: null, summary: null,
    stopReason: role === 'assistant' ? 'stop' : null, childLineId: null, attachments: [], widgets: [],
    createdAt: NOW.toISOString() });
}

export function seedNote(fake: FakeApi, id: string, markdown: string, overrides: Partial<NoteSeed> = {}): void {
  fake.control.notes.seed({
    id,
    folder: 'notes',
    pinned: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    version: 1,
    author: 'user',
    readOnly: false,
    markdown,
    ...overrides,
  });
}

/** 等事件流、假接口的微任务和计时器都走完一轮。 */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
