// 与真实接口同形状的浏览器假实现；测试和截图可注入帧，不启动或连接浏览器。
import type { BrowserApi } from '../m5b-client.ts';
import type {
  BrowserAck, BrowserActionRequest, BrowserActionResponse, BrowserFrame, BrowserStreamEvent, BrowserStreamQuery,
  BrowserTabRequest, BrowserViewDto, OpenBrowserRequest, SettleActionRequest, SettleActionResponse,
} from '../shared.ts';
import type { FakeWorkspaceDeps } from './fake-workspace.ts';

export class FakeBrowser implements BrowserApi {
  readonly actions: BrowserActionRequest['action'][] = [];
  readonly acknowledgements: number[] = [];
  private view: BrowserViewDto = { open: false, available: true, url: null, title: null,
    updatedAt: null, lastAction: null, tabs: [], activeTabId: null, controller: 'idle', instanceId: 'fake-browser' };
  private readonly deps: FakeWorkspaceDeps;
  private readonly listeners = new Set<(event: BrowserStreamEvent) => void>();
  private picture: BrowserFrame | null = null;
  private next = 0;

  constructor(deps: FakeWorkspaceDeps) { this.deps = deps; }

  async get(): Promise<BrowserViewDto> {
    this.deps.session.require();
    return this.view;
  }

  seed(view: Partial<BrowserViewDto>): void {
    this.view = { ...this.view, ...view, revision: (this.view.revision ?? 0) + 1 };
    this.emit({ type: 'status', browser: this.view });
  }

  emitFrame(frame: BrowserFrame): void {
    this.picture = frame;
    this.emit({ type: 'frame', frame });
  }

  stream(_query: BrowserStreamQuery, event: (event: BrowserStreamEvent) => void, _error: () => void): () => void {
    this.deps.session.require();
    this.listeners.add(event);
    event({ type: 'status', browser: this.view });
    if (this.picture !== null) {
      event({ type: 'frame', frame: this.picture });
    }
    return () => this.listeners.delete(event);
  }

  async ack(input: BrowserAck): Promise<void> { this.acknowledgements.push(input.sequence); }
  frameUrl(at: number): string { return `/v2/browser/frame?at=${at}`; }

  async open(input: OpenBrowserRequest): Promise<BrowserViewDto> {
    this.deps.session.require();
    const url = new URL(input.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('只允许 http / https 地址，请检查后重试。');
    }
    if (this.view.activeTabId === null) {
      await this.tab({ requestId: input.requestId, action: { kind: 'new' } });
    }
    const tabs = (this.view.tabs ?? []).map((tab) => tab.id === this.view.activeTabId
      ? { ...tab, url: input.url, title: '示例页面' } : tab);
    this.seed({ tabs, url: input.url, title: '示例页面', open: true, controller: 'user' });
    return this.view;
  }

  async tab(input: BrowserTabRequest): Promise<BrowserViewDto> {
    this.deps.session.require();
    let tabs = this.view.tabs ?? [];
    let activeTabId = this.view.activeTabId;
    const { action } = input;
    if (action.kind === 'close_all' || action.kind === 'clear_login') {
      const tab = { id: `tab-${++this.next}`, title: '新标签页', url: 'about:blank' };
      this.seed({ tabs: [tab], activeTabId: tab.id, url: tab.url, title: tab.title, open: true,
        lastAction: action.kind === 'clear_login' ? '已清空登录' : '已关掉原页面' });
      return this.view;
    }
    if (action.kind === 'new') {
      const tab = { id: `tab-${++this.next}`, title: '新标签页', url: 'about:blank' };
      tabs = [...tabs, tab];
      activeTabId = tab.id;
    } else if (action.kind === 'close') {
      tabs = tabs.filter((tab) => tab.id !== action.tabId);
      if (tabs.length === 0) {
        tabs = [{ id: `tab-${++this.next}`, title: '新标签页', url: 'about:blank' }];
      }
      if (activeTabId === action.tabId) {
        activeTabId = tabs[0]?.id ?? null;
      }
    } else {
      activeTabId = action.tabId;
    }
    const active = tabs.find((tab) => tab.id === activeTabId);
    this.seed({ tabs, activeTabId: activeTabId ?? null, open: active !== undefined,
      url: active?.url ?? null, title: active?.title ?? null, controller: 'user' });
    return this.view;
  }

  async act(input: BrowserActionRequest): Promise<BrowserActionResponse> {
    this.deps.session.require();
    if (input.tabId !== this.view.activeTabId) {
      if (input.action.kind !== 'key' || input.action.event !== 'up') {
        throw new Error('标签页已变化，请看新画面后重新操作。');
      }
      if (!this.view.tabs?.some((tab) => tab.id === input.tabId)) {
        return { browser: this.view, outcome: 'done' };
      }
    }
    this.actions.push(input.action);
    this.seed({ controller: 'user' });
    return { browser: this.view, outcome: 'done' };
  }

  async settle(_requestId: string, input: SettleActionRequest): Promise<SettleActionResponse> {
    return { status: input.happened ? 'succeeded' : 'failed' };
  }

  private emit(event: BrowserStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
