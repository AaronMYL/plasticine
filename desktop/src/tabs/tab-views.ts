// 应用内浏览器的视图层：每个网页标签一个 WebContentsView（共用一个持久的 session，和界面自己的 Cookie 分开，网站登录
// 留在这台电脑上）。开、关、切换、排序、置顶、分组都由界面管数据，界面每次变化发一整份 sync；壳只管视图：第一次见到的
// 标签载入地址，清单里没有了的关掉（壳自己开的标签界面认领前不关），在前的那个按界面给的位置显示，其余藏起来。
// 叠在界面上面还是垫到下面见 tab-layering.ts。地址、标题、能否前进后退、载入中变了报 state；新窗口、target=_blank
// 开成新标签并切过去（opened）；http(s) 以外的链接交给系统。

import { randomUUID } from 'node:crypto';
import { WebContentsView, shell, type BaseWindow, type Session, type WebContents } from 'electron';
import type { WebTabEvent, WebTabFrame, WebTabsSync } from '../../../agent/shared/api/mac-bridge.ts';
import { TAB_CHANNELS } from '../app/channels.ts';
import { tabLayer, viewBounds, type TabLayer } from './tab-layering.ts';
import { reportedUrl } from './tab-url.ts';

/** 叫标签里的脚本做事的时限：圈一块要等他框，给足五分钟；别的 30 秒。 */
const CALL_TIMEOUT_MS = 30_000;
const CIRCLE_TIMEOUT_MS = 5 * 60_000;
/** 壳自己开的标签等界面认领的时限：过了还没进清单就关掉。 */
const CLAIM_MS = 10_000;

export interface Tab {
  id: string;
  view: WebContentsView;
  openedBy: 'user' | 'plasticine';
  /** 用户最近一次在这个标签里动键鼠的时间（他正看着时 Plasticine 不点不填）。 */
  lastInputAt: number;
  /**
   * 最近一次叫它载入的网址（11-08）：Electron 在 did-start-loading 时 getURL() 还是空的，要到 did-navigate 才有；
   * 那之前报给界面的网址用这个，空网址界面会当成站内首页、关掉标签。
   */
  requestedUrl: string;
}

export interface TabViewsDeps {
  window: BaseWindow;
  ui: WebContentsView;
  session: Session;
  preload: string;
  userAgent: string;
  emit(event: WebTabEvent): void;
  /** 标签里按下鼠标（界面收起非模态浮层）。 */
  pointer(): void;
  /** 页面换了文档（翻译要接着开）。 */
  loaded(tab: Tab): void;
  /** 在前的标签的光标换了（垫在界面下面时由界面 preload 照着换）。 */
  cursor(type: string): void;
  /** 标签里的翻译脚本发来一条（tab:translate）。 */
  translate(tab: Tab, message: unknown): void;
  /** 网站图标换了（page-favicon-updated 的候选地址，按优先顺序）。 */
  favicon(tab: Tab, urls: string[]): void;
  log(line: string): void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function isWeb(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export class TabViews {
  private readonly deps: TabViewsDeps;
  private readonly tabs = new Map<string, Tab>();
  private readonly unclaimed = new Map<string, number>();
  private readonly calls = new Map<string, PendingCall>();
  private activeId: string | null = null;
  private frameValue: WebTabFrame | null = null;
  private hitRegions: WebTabFrame[] | undefined;
  private layerValue: TabLayer = 'above';

  constructor(deps: TabViewsDeps) {
    this.deps = deps;
  }

  get active(): Tab | null {
    return this.activeId === null ? null : this.tabs.get(this.activeId) ?? null;
  }

  get frame(): WebTabFrame | null {
    return this.frameValue;
  }

  get layer(): TabLayer {
    return this.layerValue;
  }

  get(tabId: string): Tab | null {
    return this.tabs.get(tabId) ?? null;
  }

  list(): Tab[] {
    return [...this.tabs.values()];
  }

  /** 网页标签里的 preload 回的消息：按发消息的 webContents 认是哪个标签。 */
  tabOf(contents: WebContents): Tab | null {
    return this.list().find((tab) => tab.view.webContents === contents) ?? null;
  }

  sync(state: WebTabsSync): void {
    const wanted = new Set(state.tabs.map((tab) => tab.tabId));
    for (const entry of state.tabs) {
      this.unclaimed.delete(entry.tabId);
      if (!this.tabs.has(entry.tabId)) {
        this.create(entry.tabId, entry.url, entry.openedBy ?? 'user');
      }
    }
    const now = Date.now();
    for (const tab of this.list()) {
      const openedAt = this.unclaimed.get(tab.id);
      if (!wanted.has(tab.id) && (openedAt === undefined || now - openedAt > CLAIM_MS)) {
        this.close(tab.id);
      }
    }
    this.activeId = state.active !== null && this.tabs.has(state.active) ? state.active : null;
    this.frameValue = state.frame;
    this.hitRegions = state.hitRegions;
    this.layout();
  }

  /** 壳自己开一个标签（新窗口、tab_open）；activate 为 false 时在后台开，不抢他正看着的。 */
  open(url: string, openedBy: 'user' | 'plasticine', activate: boolean): Tab {
    const tab = this.create(`t-${randomUUID()}`, url, openedBy);
    this.unclaimed.set(tab.id, Date.now());
    this.deps.emit({ type: 'opened', tabId: tab.id, url, title: '', openedBy, activate });
    return tab;
  }

  command(tabId: string, command: string): void {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) {
      return;
    }
    const history = tab.view.webContents.navigationHistory;
    switch (command) {
      case 'back':
        if (history.canGoBack()) { history.goBack(); }
        break;
      case 'forward':
        if (history.canGoForward()) { history.goForward(); }
        break;
      case 'reload':
        tab.view.webContents.reload();
        break;
      case 'stop':
        tab.view.webContents.stop();
        break;
      case 'open_external':
        void shell.openExternal(tab.view.webContents.getURL());
        break;
      case 'close':
        this.close(tabId);
        break;
      default:
        this.deps.log(`网页标签不认识的命令：${command}`);
    }
  }

  navigate(tabId: string, url: string): void {
    if (!isWeb(url)) {
      return;
    }
    const tab = this.tabs.get(tabId);
    if (tab !== undefined) {
      tab.requestedUrl = url;
    }
    void tab?.view.webContents.loadURL(url).catch((error: unknown) => {
      this.deps.log(`网页没载入：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /** 叫这个标签里的 preload 做一件事（tab-preload.ts 的 op）。 */
  call(tabId: string, op: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) {
      return Promise.reject(new Error('没有这个网页标签了。'));
    }
    const id = randomUUID();
    const timeout = op === 'circle' ? CIRCLE_TIMEOUT_MS : CALL_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error('网页没有按时回话（可能正在换页）。'));
      }, timeout);
      this.calls.set(id, { resolve, reject, timer });
      tab.view.webContents.send(TAB_CHANNELS.call, { id, op, args });
    });
  }

  /** tab:reply 进来的回话。 */
  reply(message: { id?: unknown; ok?: unknown; value?: unknown; error?: unknown }): void {
    const pending = typeof message.id === 'string' ? this.calls.get(message.id) : undefined;
    if (pending === undefined || typeof message.id !== 'string') {
      return;
    }
    this.calls.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok === true) {
      pending.resolve(message.value);
    } else {
      pending.reject(new Error(typeof message.error === 'string' ? message.error : '网页里的脚本出错了。'));
    }
  }

  /** 网页标签垫在界面下面时，界面 preload 截下来的鼠标事件转给在前的标签（坐标换成标签自己的）。 */
  forward(input: Electron.MouseInputEvent | Electron.MouseWheelInputEvent): void {
    const tab = this.active;
    const frame = this.frameValue;
    if (tab === null || frame === null || this.layerValue !== 'below') {
      return;
    }
    const bounds = viewBounds(frame);
    if (input.type === 'mouseDown') {
      tab.view.webContents.focus();
      tab.lastInputAt = Date.now();
    }
    tab.view.webContents.sendInputEvent({ ...input, x: Math.round(input.x - bounds.x),
      y: Math.round(input.y - bounds.y) });
  }

  closeAll(): void {
    for (const tab of this.list()) {
      this.close(tab.id);
    }
  }

  private create(tabId: string, url: string, openedBy: 'user' | 'plasticine'): Tab {
    const view = new WebContentsView({ webPreferences: { session: this.deps.session, preload: this.deps.preload,
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
    view.setVisible(false);
    view.webContents.setUserAgent(this.deps.userAgent);
    const tab: Tab = { id: tabId, view, openedBy, lastInputAt: 0, requestedUrl: isWeb(url) ? url : '' };
    this.tabs.set(tabId, tab);
    this.deps.window.contentView.addChildView(view, 0);
    this.watch(tab);
    if (isWeb(url)) {
      void view.webContents.loadURL(url).catch((error: unknown) => {
        this.deps.log(`网页没载入：${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return tab;
  }

  private close(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (tab === undefined) {
      return;
    }
    this.tabs.delete(tabId);
    this.unclaimed.delete(tabId);
    this.deps.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (this.activeId === tabId) {
      this.activeId = null;
    }
  }

  private layout(): void {
    const frame = this.frameValue;
    const active = this.active;
    this.layerValue = tabLayer(frame, this.hitRegions);
    // 垫到下面时界面在那一块不画底色；叠在上面时界面照常。
    for (const tab of this.list()) {
      const shown = tab === active && frame !== null && frame.width > 0 && frame.height > 0;
      if (shown && frame !== null) {
        tab.view.setBounds(viewBounds(frame));
        const children = this.deps.window.contentView.children;
        const uiIndex = children.indexOf(this.deps.ui);
        const index = this.layerValue === 'above' ? children.length : Math.max(0, uiIndex);
        this.deps.window.contentView.addChildView(tab.view, index);
      }
      tab.view.setVisible(shown);
    }
  }

  private state(tab: Tab): void {
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) {
      return;
    }
    const url = reportedUrl(contents.getURL(), tab.requestedUrl);
    if (url === null) {
      return;
    }
    const history = contents.navigationHistory;
    this.deps.emit({ type: 'state', tabId: tab.id, url, title: contents.getTitle(),
      canGoBack: history.canGoBack(), canGoForward: history.canGoForward(), loading: contents.isLoading() });
  }

  private watch(tab: Tab): void {
    const contents = tab.view.webContents;
    const report = (): void => this.state(tab);
    contents.on('did-start-loading', report);
    contents.on('did-stop-loading', report);
    contents.on('did-navigate', report);
    contents.on('did-navigate-in-page', report);
    contents.on('page-title-updated', report);
    contents.on('did-finish-load', () => this.deps.loaded(tab));
    contents.on('page-favicon-updated', (_event, urls) => this.deps.favicon(tab, urls));
    contents.ipc.on(TAB_CHANNELS.translate, (_event, message: unknown) => this.deps.translate(tab, message));
    contents.on('cursor-changed', (_event, type) => {
      if (tab === this.active) {
        this.deps.cursor(type);
      }
    });
    contents.on('input-event', (_event, input) => {
      if (input.type === 'mouseDown' || input.type === 'keyDown' || input.type === 'mouseWheel') {
        tab.lastInputAt = Date.now();
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isWeb(url)) {
        this.open(url, 'user', true);
      } else if (/^(mailto|tel):/i.test(url)) {
        void shell.openExternal(url);
      }
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isWeb(url) && !url.startsWith('about:')) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    });
    contents.ipc.on(TAB_CHANNELS.reply, (_event, message: Record<string, unknown>) => this.reply(message));
    contents.ipc.on(TAB_CHANNELS.pointer, () => {
      tab.lastInputAt = Date.now();
      this.deps.pointer();
    });
  }
}
