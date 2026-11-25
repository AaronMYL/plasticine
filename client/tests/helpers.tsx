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
  storage?: KeyValueStorage | null;
  pushDevice?: FakePushDevice;
  modelConnected?: boolean;
}

export function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

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

export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
