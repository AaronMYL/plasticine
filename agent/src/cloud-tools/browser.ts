// 浏览器状态和操作占用只留内存。用户一动手即取消脑当前和排队的步骤；输入不经状态库或日志。
import { Value } from 'typebox/value';
import { BrowserActionInputSchema, type BrowserTabAction, type BrowserViewDto } from '../../shared/api/browser.ts';
import { browserUrl } from './browser-url.ts';
import type { BrowserAction, BrowserPage, BrowserSnapshot, BrowserTransport } from './transports.ts';
import { CloudToolError } from './errors.ts';
import { BrowserRequests } from './browser-requests.ts';
import { BrowserTaskState } from './browser-task-state.ts';
import type { BrowserInspection } from '../../shared/browser-observation.ts';

export const FRAME_MAX_PX = 4_096;
export const TYPE_MAX_CHARS = 2_000;
export const SCROLL_MAX_PX = 10_000;
const NAMED_KEYS = [
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph',
  'Insert', 'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'ContextMenu', 'PrintScreen',
];
export const KEY_PATTERN = new RegExp(`^(?:${NAMED_KEYS.join('|')}|F(?:[1-9]|1[0-2]))$`);
export const PAGE_TEXT_MAX_CHARS = 8_000;
export type BrowserView = BrowserViewDto;
export interface BrowserSink { browserChanged(view: BrowserView): void }
export interface BrowserObservation { id: string; tabId: string; page: BrowserInspection; image: Buffer }

function describe(action: BrowserAction): string {
  switch (action.kind) {
    case 'click': return `点了 (${action.x}, ${action.y})`;
    case 'move': return '移动鼠标';
    case 'type': return '输入了文字';
    case 'key': return '按了键';
    case 'scroll': return '滚动了页面';
    case 'back': return '后退';
    case 'forward': return '前进';
    case 'reload': return '刷新';
    case 'stop': return '停止加载';
  }
}

export function checkAction(action: BrowserAction): BrowserAction {
  if (!Value.Check(BrowserActionInputSchema, action)) {
    throw new CloudToolError('invalid_input', '浏览器操作格式不对，请刷新后重试。', 'action');
  }
  if (action.kind === 'key' && action.key.length !== 1 && !KEY_PATTERN.test(action.key)) {
    throw new CloudToolError('invalid_input', '不认识的按键，请用页面上的按键操作。', 'action');
  }
  return action;
}

export class CloudBrowser {
  readonly #transport: BrowserTransport;
  readonly #now: () => Date;
  readonly #tasks: BrowserTaskState;
  readonly requests = new BrowserRequests();
  #page: BrowserPage | null = null;
  #snapshot: BrowserSnapshot = { tabs: [], activeTabId: null };
  #available = false;
  #updatedAt: string | null = null;
  #lastAction: string | null = null;
  #controller: 'idle' | 'brain' | 'user' = 'idle';
  #sink: BrowserSink | null = null;
  readonly #listeners = new Set<(view: BrowserView) => void>();
  readonly #brain = new Set<AbortController>();
  #tail: Promise<unknown> = Promise.resolve();
  #revision = 0;
  readonly #lifetime = new AbortController();
  readonly #internalUrl: string | undefined;

  constructor(options: { transport: BrowserTransport; now: () => Date; stateDirectory?: string;
    internalUrl?: string }) {
    this.#transport = options.transport;
    this.#now = options.now;
    this.#tasks = new BrowserTaskState(options.stateDirectory);
    this.#internalUrl = options.internalUrl;
  }

  attach(sink: BrowserSink): void { this.#sink = sink; }

  subscribe(listener: (view: BrowserView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  view(): BrowserView {
    return {
      open: this.#page !== null, url: this.#page?.url ?? null, title: this.#page?.title ?? null,
      updatedAt: this.#updatedAt, lastAction: this.#lastAction, available: this.#available,
      tabs: this.#snapshot.tabs, activeTabId: this.#snapshot.activeTabId, controller: this.#controller,
      instanceId: this.requests.id, revision: this.#revision,
      loading: this.#snapshot.loading ?? false,
      editableFocused: this.#page?.editableFocused ?? false,
    };
  }

  async refresh(signal: AbortSignal): Promise<BrowserView> {
    signal = AbortSignal.any([signal, this.#lifetime.signal]);
    signal.throwIfAborted();
    if (this.#transport.snapshot === undefined) {
      return this.view();
    }
    try {
      this.#applySnapshot(await this.#transport.snapshot(signal));
      this.#available = true;
      return this.#publish();
    } catch (error) {
      this.#available = false;
      this.#publish();
      throw error;
    }
  }

  open(raw: string, signal: AbortSignal, scope?: string): Promise<BrowserView> {
    return this.#run(true, signal, async (limited) => {
      if (scope !== undefined) { await this.#selectTask(scope, limited, true); this.#tasks.invalidate(scope); }
      return this.#open(raw, limited);
    });
  }

  userOpen(raw: string, signal: AbortSignal): Promise<BrowserView> {
    return this.#run(false, signal, (limited) => this.#open(raw, limited));
  }

  async #open(raw: string, signal: AbortSignal): Promise<BrowserView> {
    let url: string;
    try {
      url = browserUrl(raw, this.#internalUrl);
    } catch {
      throw new CloudToolError('invalid_input', '地址不合要求，请输入完整的 http / https 网址。', 'url');
    }
    const page = await this.#transport.open(url, signal);
    signal.throwIfAborted();
    return this.#settle(page, '打开了页面', signal);
  }

  act(action: BrowserAction, signal: AbortSignal, scope?: string, observationId?: string): Promise<BrowserView> {
    return this.#run(true, signal, async (limited) => {
      if (scope !== undefined) {
        const page = await this.#selectTask(scope, limited);
        const inspection = await this.#inspect(page.sessionId, limited);
        this.#tasks.requireObservation(scope, observationId, page.sessionId, inspection);
      }
      return this.#act(action, limited);
    });
  }

  userAct(action: BrowserAction, signal: AbortSignal, tabId: string): Promise<BrowserView> {
    checkAction(action);
    return this.#run(false, signal, (limited) => this.#act(action, limited, tabId), action.kind === 'stop');
  }

  async #act(action: BrowserAction, signal: AbortSignal, expectedTabId?: string): Promise<BrowserView> {
    const page = await this.#current(signal);
    let tabId = page.sessionId;
    if (expectedTabId !== undefined && expectedTabId !== page.sessionId) {
      if (action.kind !== 'key' || action.event !== 'up') {
        throw new CloudToolError('invalid_input', '标签页已变化，请看新画面后重新操作。');
      }
      // 原标签可能已在远端切走；松键只清理它，不切换当前页面。关闭的标签已无按键状态。
      if (!this.#snapshot.tabs.some((tab) => tab.id === expectedTabId)) {
        return this.view();
      }
      tabId = expectedTabId;
    }
    const result = await this.#transport.act(tabId, checkAction(action), signal);
    signal.throwIfAborted();
    return this.#settle(result, describe(action), signal);
  }

  tab(action: BrowserTabAction, signal: AbortSignal): Promise<BrowserView> {
    return this.#run(false, signal, async (limited) => {
      if (this.#transport.tab === undefined) {
        throw new CloudToolError('not_configured', '浏览器还没起来，请重试。');
      }
      this.#applySnapshot(await this.#transport.tab(action, limited));
      this.#available = true;
      this.#lastAction = '操作了标签页';
      return this.#publish();
    });
  }

  publishX(text: string, signal: AbortSignal): Promise<{ url: string }> {
    return this.#run(false, signal, async (limited) => {
      if (this.#transport.publishX === undefined) throw new CloudToolError('not_configured', '当前浏览器未接发 X 通道。');
      const result = await this.#transport.publishX(text, limited);
      await this.refresh(limited);
      return result;
    });
  }

  async frame(signal: AbortSignal): Promise<Buffer> {
    return this.#transport.frame((await this.#current(signal)).sessionId, signal);
  }

  text(signal: AbortSignal, scope?: string): Promise<string> {
    return this.#run(true, signal, async (limited) => {
      const page = scope === undefined ? await this.#current(limited) : await this.#selectTask(scope, limited);
      const text = await this.#transport.text(page.sessionId, limited);
      limited.throwIfAborted();
      const chars = Array.from(text);
      return chars.length <= PAGE_TEXT_MAX_CHARS ? text : `${chars.slice(0, PAGE_TEXT_MAX_CHARS).join('')}…`;
    });
  }

  observe(signal: AbortSignal, scope?: string, tabId?: string): Promise<BrowserObservation> {
    return this.#run(true, signal, async (limited) => {
      const page = scope === undefined && tabId === undefined ? await this.#current(limited)
        : await this.#selectTask(scope ?? 'shared', limited, false, tabId);
      const inspected = await this.#inspect(page.sessionId, limited);
      const image = await this.#transport.frame(page.sessionId, limited);
      const id = this.#tasks.observe(scope ?? 'shared', page.sessionId, inspected);
      return { id, tabId: page.sessionId, page: inspected, image };
    });
  }

  async #inspect(tabId: string, signal: AbortSignal): Promise<BrowserInspection> {
    if (this.#transport.observe === undefined) {
      throw new CloudToolError('not_configured', '这个浏览器连接还不能观察元素与画面。');
    }
    return this.#transport.observe(tabId, signal);
  }

  async #selectTask(scope: string, signal: AbortSignal, create = false, requestedTab?: string): Promise<BrowserPage> {
    if (this.#transport.tab === undefined || this.#transport.snapshot === undefined) {
      throw new CloudToolError('not_configured', '这个浏览器连接还不能为任务固定标签。');
    }
    await this.refresh(signal);
    let tabId = requestedTab ?? this.#tasks.tab(scope);
    if (tabId === undefined || !this.#snapshot.tabs.some((tab) => tab.id === tabId)) {
      if (!create || requestedTab !== undefined) {
        throw new CloudToolError('invalid_input', '任务尚未绑定可用标签；先打开网址，或观察时选择实际存在的 tabId。');
      }
      this.#applySnapshot(await this.#transport.tab({ kind: 'new' }, signal));
      tabId = this.#snapshot.activeTabId ?? undefined;
    }
    if (tabId === undefined) { throw new CloudToolError('failed', '浏览器没有返回任务标签，请重新打开网址。'); }
    if (this.#tasks.tab(scope) !== tabId) { this.#tasks.bind(scope, tabId); }
    if (this.#snapshot.activeTabId !== tabId) {
      this.#applySnapshot(await this.#transport.tab({ kind: 'switch', tabId }, signal));
    }
    return this.#current(signal);
  }

  watch: NonNullable<BrowserTransport['watch']> = async (viewport, frame, disconnected, signal) => {
    if (this.#transport.watch === undefined) {
      throw new CloudToolError('not_configured', '浏览器还没起来，请重试。');
    }
    await this.refresh(signal);
    return this.#transport.watch(viewport, frame, () => {
      this.#available = false;
      this.#publish();
      disconnected();
    }, signal, (snapshot) => {
      this.#applySnapshot(snapshot);
      this.#publish();
    });
  };

  #run<T>(brain: boolean, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>,
    immediate = false): Promise<T> {
    const controller = new AbortController();
    if (brain) {
      this.#brain.add(controller);
    } else {
      this.#tasks.invalidate();
      for (const pending of this.#brain) {
        pending.abort(new CloudToolError('user_takeover', '用户接手了。请等用户操作结束后再继续。'));
      }
      this.#controller = 'user';
      this.#publish();
    }
    const limited = AbortSignal.any([signal, controller.signal, this.#lifetime.signal]);
    // 停止加载不能排在尚未收到响应的导航后面，否则慢网站会让停止按钮失效。
    const result = (immediate ? Promise.resolve() : this.#tail).then(async () => {
      limited.throwIfAborted();
      if (brain) {
        this.#controller = 'brain';
        this.#publish();
      }
      try {
        const value = await work(limited);
        limited.throwIfAborted();
        return value;
      } finally {
        this.#brain.delete(controller);
        if (brain && this.#controller === 'brain') {
          this.#controller = 'idle';
          this.#publish();
        }
      }
    });
    // 错误由 result 的调用者处理；队列本身继续，用户的接手不会被前一步的拒绝阻塞。
    if (!immediate) {
      this.#tail = result.then(() => undefined, () => { this.#brain.delete(controller); });
    }
    return result;
  }

  async #current(signal: AbortSignal): Promise<BrowserPage> {
    if (this.#transport.snapshot !== undefined) {
      await this.refresh(signal);
    }
    if (this.#page === null) {
      throw new CloudToolError('invalid_input', '云端浏览器还没有打开页面；先打开一个网址。');
    }
    return this.#page;
  }

  async #settle(page: BrowserPage, lastAction: string, signal: AbortSignal): Promise<BrowserView> {
    this.#page = { ...page, url: this.#display(page.url) };
    this.#available = true;
    this.#lastAction = lastAction;
    if (this.#transport.snapshot !== undefined) {
      try {
        this.#applySnapshot(await this.#transport.snapshot(signal));
      } catch (error) {
        if (error instanceof CloudToolError && error.code === 'user_takeover') {
          throw error;
        }
        throw new CloudToolError('unknown', '操作已发送但状态尚未核实，请核对画面后再操作。');
      }
    } else {
      this.#snapshot = { tabs: [{ id: page.sessionId, title: page.title, url: this.#page.url }],
        activeTabId: page.sessionId };
    }
    return this.#publish();
  }

  #display(url: string): string {
    if (url === 'about:blank') {
      return url;
    }
    try {
      return browserUrl(url, this.#internalUrl);
    } catch {
      // 浏览器内部页可以显示和关闭，但不能把内部地址当作可导航 URL 返回。
      return 'about:blank';
    }
  }

  #applySnapshot(snapshot: BrowserSnapshot): void {
    this.#snapshot = { ...snapshot, tabs: snapshot.tabs.map((tab) => ({ ...tab, url: this.#display(tab.url) })) };
    const page = this.#snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
    const editableFocused = page?.id === this.#page?.sessionId && page?.url === this.#page?.url
      && (this.#page?.editableFocused ?? false);
    this.#page = page === undefined ? null : { sessionId: page.id, url: page.url, title: page.title, editableFocused };
  }

  #publish(): BrowserView {
    this.#revision += 1;
    this.#updatedAt = this.#now().toISOString();
    const view = this.view();
    this.#sink?.browserChanged(view);
    for (const listener of this.#listeners) {
      listener(view);
    }
    return view;
  }

  close(): void {
    this.#lifetime.abort();
    for (const pending of this.#brain) {
      pending.abort(new CloudToolError('failed', '浏览器服务正在停止。'));
    }
    this.#transport.close?.();
    this.#listeners.clear();
  }

  disconnect(): void {
    this.#transport.disconnect?.();
    this.#available = false;
    this.#publish();
  }
}
