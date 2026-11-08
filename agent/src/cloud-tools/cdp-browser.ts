import { publishXThroughPage } from './x-publish.ts';
// 唯一的有头浏览器；这里只连用户 systemd 服务的回环 CDP，不负责起进程或碰 profile 文件。
import type { BrowserFrame, BrowserTab, BrowserTabAction, BrowserViewport } from '../../shared/api/browser.ts';
import { browserUrl } from './browser-url.ts';
import { CdpConnection } from './cdp-connection.ts';
import { dispatchInput } from './cdp-input.ts';
import {
  cdpValue, CdpDataSchema, CdpSessionSchema, CdpTargetSchema, CdpTargetsSchema, CdpTextSchema, CdpBooleanSchema,
  CdpFrameTreeSchema, CdpFrameIdSchema, CdpNavigatedSchema, CdpWithinDocumentSchema, type CdpEvent,
} from './cdp-protocol.ts';
import { screencast } from './cdp-screencast.ts';
import { restoreDesktop } from './cdp-viewport.ts';
import { CloudToolError } from './errors.ts';
import type { BrowserAction, BrowserPage, BrowserSnapshot, BrowserTransport, BrowserWatch } from './transports.ts';
import type { BrowserInspection } from '../../shared/browser-observation.ts';
import { CdpInspectionSchema, OBSERVE_PAGE } from './cdp-observation.ts';

const CDP_ENDPOINT = 'http://127.0.0.1:9333';
const RELEASE_TIMEOUT_MS = 5_000;
// 只返回能否编辑，不读取字段值；按钮、选择器和只读字段不会唤起手机文字键盘。
const EDITABLE_FOCUS = `(() => {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }
  const textInput = element?.tagName === 'INPUT'
    && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color'].includes(element.type);
  return Boolean(element && (element.isContentEditable
    || ((textInput || element.tagName === 'TEXTAREA') && !element.disabled && !element.readOnly)));
})()`;
interface Watching {
  viewport: BrowserViewport;
  frame: (frame: BrowserFrame) => void;
  disconnected: () => void;
  current: BrowserWatch | null;
  changed: (snapshot: BrowserSnapshot) => void;
}

/** 仅装配层提供本实例的系统会话；不从模型或待打开的 URL 接收这些字段。 */
export interface InternalBrowserCookie {
  name: string;
  value: string;
  url: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict';
  expires: number;
}

export class CdpBrowser implements BrowserTransport {
  readonly #endpoint: string;
  #connection: CdpConnection | null = null;
  #connecting: Promise<CdpConnection> | null = null;
  readonly #sessions = new Map<string, string>();
  readonly #initializing = new Map<string, Promise<string>>();
  readonly #mainFrames = new Map<string, string>();
  readonly #loading = new Set<string>();
  #tabs: BrowserTab[] = [];
  #active: string | null = null;
  #watching: Watching | null = null;
  #sequence = 0;
  #casting: Watching | null = null;
  #castTail: Promise<void> = Promise.resolve();
  #castingTabId: string | null = null;
  #targetRevision = 0;
  readonly #lifetime = new AbortController();
  readonly #internalCookies: (() => InternalBrowserCookie[]) | undefined;
  readonly #internalUrl: string | undefined;

  constructor(options: { endpoint?: string; internalCookies?: () => InternalBrowserCookie[];
    internalUrl?: string } = {}) {
    this.#endpoint = options.endpoint ?? CDP_ENDPOINT;
    this.#internalCookies = options.internalCookies;
    this.#internalUrl = options.internalUrl;
  }

  get connected(): boolean { return this.#connection !== null; }

  async #connect(signal: AbortSignal): Promise<CdpConnection> {
    signal.throwIfAborted();
    this.#lifetime.signal.throwIfAborted();
    if (this.#connection !== null) {
      await this.#prepareCookies(this.#connection, signal);
      return this.#connection;
    }
    this.#connecting ??= CdpConnection.connect(this.#endpoint,
      AbortSignal.any([signal, this.#lifetime.signal]), () => {
        this.#connection = null;
        this.#sessions.clear();
        this.#initializing.clear();
        this.#mainFrames.clear();
        this.#loading.clear();
        this.#casting = null;
        this.#castingTabId = null;
        const watching = this.#watching;
        this.#watching = null;
        watching?.disconnected();
      }).then(async (connection) => {
        try { await this.#prepareCookies(connection, signal); } catch (error) { connection.close(); throw error; }
        this.#connection = connection;
        connection.onEvent((event) => this.#pageEvent(event));
        return connection;
      }).finally(() => { this.#connecting = null; });
    return this.#connecting;
  }

  async #prepareCookies(connection: CdpConnection, signal: AbortSignal): Promise<void> {
    const cookies = this.#internalCookies?.() ?? [];
    if (cookies.length === 0) return;
    // 每次受控操作恢复本站系统身份，防止导入登录或网页改写后留下用户 Cookie。外站和 profile 原样保留。
    await connection.send('Storage.setCookies', { cookies }, signal);
  }

  async snapshot(signal: AbortSignal): Promise<BrowserSnapshot> {
    const connection = await this.#connect(signal);
    const revision = this.#targetRevision;
    const result = cdpValue(CdpTargetsSchema, await connection.send('Target.getTargets', {}, signal));
    if (revision !== this.#targetRevision) {
      return this.snapshot(signal);
    }
    const tabs = result.targetInfos.filter((target) => target.type === 'page')
      .map((target) => ({ id: target.targetId, url: target.url, title: target.title }));
    const previous = this.#active;
    if (!tabs.some((tab) => tab.id === this.#active) && this.#active !== (tabs[0]?.id ?? null)) {
      this.#active = tabs[0]?.id ?? null;
      this.#targetRevision += 1;
    }
    this.#tabs = tabs;
    const snapshot = this.#state();
    if (previous !== this.#active && this.#watching !== null) {
      const closed = !tabs.some((tab) => tab.id === this.#castingTabId);
      await this.#queueCast(() => this.#stopCast(closed));
      this.#watching?.changed(snapshot);
      await this.#restartCast(signal);
    }
    return snapshot;
  }

  async #session(tabId: string, signal: AbortSignal): Promise<{ connection: CdpConnection; sessionId: string }> {
    const connection = await this.#connect(signal);
    const ready = this.#sessions.get(tabId);
    if (ready !== undefined) {
      return { connection, sessionId: ready };
    }
    let initializing = this.#initializing.get(tabId);
    if (initializing === undefined) {
      initializing = this.#initialize(connection, tabId, signal);
      this.#initializing.set(tabId, initializing);
    }
    try {
      const sessionId = await initializing;
      signal.throwIfAborted();
      return { connection, sessionId };
    } finally {
      if (this.#initializing.get(tabId) === initializing) {
        this.#initializing.delete(tabId);
      }
    }
  }

  async #initialize(connection: CdpConnection, tabId: string, signal: AbortSignal): Promise<string> {
    const { sessionId } = cdpValue(CdpSessionSchema,
      await connection.send('Target.attachToTarget', { targetId: tabId, flatten: true }, signal));
    try {
      const tree = cdpValue(CdpFrameTreeSchema, await connection.send('Page.getFrameTree', {}, signal, sessionId));
      await connection.send('Page.enable', {}, signal, sessionId);
      await restoreDesktop(connection, sessionId, signal);
      if (connection !== this.#connection || !this.#initializing.has(tabId)) {
        throw new CloudToolError('unknown', '浏览器连接已变化，请重试。');
      }
      this.#mainFrames.set(tabId, tree.frameTree.frame.id);
      this.#sessions.set(tabId, sessionId);
      return sessionId;
    } catch (error) {
      // 失败的附着不留在 Chromium；断线则关闭连接，让后一次从新会话开始。
      await connection.send('Target.detachFromTarget', { sessionId }, AbortSignal.timeout(RELEASE_TIMEOUT_MS))
        .catch(() => connection.close());
      throw error;
    }
  }

  #state(): BrowserSnapshot {
    return { tabs: this.#tabs, activeTabId: this.#active, loading: this.#loading.has(this.#active ?? '') };
  }

  #pageEvent(event: CdpEvent): void {
    const tabId = [...this.#sessions].find(([, session]) => session === event.sessionId)?.[0];
    if (tabId === undefined) {
      return;
    }
    let url: string | undefined;
    switch (event.method) {
      case 'Page.frameStartedLoading':
      case 'Page.frameStoppedLoading': {
        const { frameId } = cdpValue(CdpFrameIdSchema, event.params);
        if (frameId !== this.#mainFrames.get(tabId)) {
          return;
        }
        if (event.method === 'Page.frameStartedLoading') {
          this.#loading.add(tabId);
        } else {
          this.#loading.delete(tabId);
        }
        break;
      }
      case 'Page.frameNavigated': {
        const { frame } = cdpValue(CdpNavigatedSchema, event.params);
        if (frame.parentId !== undefined) {
          return;
        }
        this.#mainFrames.set(tabId, frame.id);
        url = frame.url;
        break;
      }
      case 'Page.navigatedWithinDocument': {
        const navigation = cdpValue(CdpWithinDocumentSchema, event.params);
        if (navigation.frameId !== this.#mainFrames.get(tabId)) {
          return;
        }
        url = navigation.url;
        break;
      }
      default: return;
    }
    if (url !== undefined) {
      this.#targetRevision += 1;
      this.#tabs = this.#tabs.map((tab) => tab.id === tabId ? { ...tab, url } : tab);
    }
    this.#watching?.changed(this.#state());
  }

  async #page(signal: AbortSignal): Promise<BrowserPage> {
    const snapshot = await this.snapshot(signal);
    const page = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
    if (page === undefined) {
      throw new CloudToolError('invalid_input', '浏览器还没有打开页面，请新开一个标签页。');
    }
    return { sessionId: page.id, title: page.title, url: page.url };
  }

  async open(url: string, signal: AbortSignal): Promise<BrowserPage> {
    // 即使绕过 CloudBrowser 调用传输，也不能用 file/javascript 等方案导航。
    const cleaned = browserUrl(url, this.#internalUrl);
    const snapshot = await this.snapshot(signal);
    if (snapshot.activeTabId === null) {
      await this.tab({ kind: 'new' }, signal);
    }
    const page = await this.#page(signal);
    const { connection, sessionId } = await this.#session(page.sessionId, signal);
    const result = await connection.send('Page.navigate', { url: cleaned }, signal, sessionId);
    if (typeof result === 'object' && result !== null && 'errorText' in result) {
      throw new CloudToolError('failed', '页面没有打开，请检查地址后重试。');
    }
    return this.#page(signal);
  }

  async act(tabId: string, action: BrowserAction, signal: AbortSignal): Promise<BrowserPage> {
    const { connection, sessionId } = await this.#session(tabId, signal);
    await dispatchInput(action, (method, params = {}) => connection.send(method, params, signal, sessionId),
      (method, params = {}) => connection.send(method, params, AbortSignal.timeout(RELEASE_TIMEOUT_MS), sessionId));
    try {
      const page = await this.#page(signal);
      if (action.kind !== 'click') {
        return page;
      }
      const focus = cdpValue(CdpBooleanSchema, await connection.send('Runtime.evaluate', {
        expression: EDITABLE_FOCUS, returnByValue: true,
      }, signal, sessionId));
      return { ...page, editableFocused: focus.result.value };
    } catch (error) {
      if (error instanceof CloudToolError && error.code === 'user_takeover') {
        throw error;
      }
      throw new CloudToolError('unknown', '输入已发送但画面尚未核实，请核对后再操作。');
    }
  }

  async publishX(text: string, signal: AbortSignal): Promise<{ url: string }> {
    await this.tab({ kind: 'new' }, signal);
    const page = await this.open('https://x.com/compose/post', signal);
    const { connection, sessionId } = await this.#session(page.sessionId, signal);
    return publishXThroughPage(connection, sessionId, text, signal);
  }

  async frame(tabId: string, signal: AbortSignal): Promise<Buffer> {
    const { connection, sessionId } = await this.#session(tabId, signal);
    const data = cdpValue(CdpDataSchema, await connection.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false }, signal, sessionId));
    return Buffer.from(data.data, 'base64');
  }

  async text(tabId: string, signal: AbortSignal): Promise<string> {
    const { connection, sessionId } = await this.#session(tabId, signal);
    // 只读取 body 文本，不读 input.value、密码字段、cookies 或存储。
    const data = cdpValue(CdpTextSchema, await connection.send('Runtime.evaluate', {
      expression: '(document.body?.innerText ?? "").slice(0, 8000)', returnByValue: true,
    }, signal, sessionId));
    return data.result.value;
  }

  async observe(tabId: string, signal: AbortSignal): Promise<BrowserInspection> {
    const { connection, sessionId } = await this.#session(tabId, signal);
    const data = cdpValue(CdpInspectionSchema, await connection.send('Runtime.evaluate', {
      expression: OBSERVE_PAGE, returnByValue: true,
    }, signal, sessionId));
    return data.result.value;
  }

  async tab(action: BrowserTabAction, signal: AbortSignal): Promise<BrowserSnapshot> {
    const snapshot = await this.snapshot(signal);
    const connection = await this.#connect(signal);
    if (action.kind === 'close_all' || action.kind === 'clear_login') {
      if (action.kind === 'clear_login') {
        await connection.send('Storage.clearCookies', {}, signal);
        for (const origin of new Set(snapshot.tabs.filter((tab) => /^https?:/.test(tab.url))
          .map((tab) => new URL(tab.url).origin))) {
          await connection.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }, signal);
        }
      }
      // 保留空白页让有头进程存活；所有原页面关闭，已清登录的页面不能继续持有会话。
      await this.tab({ kind: 'new' }, signal);
      for (const tab of snapshot.tabs) { await this.tab({ kind: 'close', tabId: tab.id }, signal); }
      return this.snapshot(signal);
    }
    if (action.kind !== 'new' && !snapshot.tabs.some((tab) => tab.id === action.tabId)) {
      throw new CloudToolError('invalid_input', '这个标签页已关闭，请选另一个标签页。');
    }
    await this.#queueCast(() => this.#stopCast());
    this.#targetRevision += 1;
    if (action.kind === 'new') {
      const target = cdpValue(CdpTargetSchema,
        await connection.send('Target.createTarget', { url: 'about:blank' }, signal));
      this.#active = target.targetId;
    } else if (action.kind === 'close') {
      if (snapshot.tabs.length === 1) {
        // 留一个空白页，让关闭最后一页不会让有头 Chromium 正常退出（用户服务只在失败时重启）。
        const blank = cdpValue(CdpTargetSchema,
          await connection.send('Target.createTarget', { url: 'about:blank' }, signal));
        this.#active = blank.targetId;
      }
      await connection.send('Target.closeTarget', { targetId: action.tabId }, signal);
      this.#sessions.delete(action.tabId);
      this.#initializing.delete(action.tabId);
      this.#mainFrames.delete(action.tabId);
      this.#loading.delete(action.tabId);
      if (this.#active === action.tabId) {
        this.#active = snapshot.tabs.find((tab) => tab.id !== action.tabId)?.id ?? null;
      }
    } else {
      this.#active = action.tabId;
    }
    this.#targetRevision += 1;
    if (this.#active !== null) {
      await connection.send('Target.activateTarget', { targetId: this.#active }, signal);
    }
    const result = await this.snapshot(signal);
    this.#watching?.changed(result);
    await this.#restartCast(signal);
    return result;
  }

  async watch(viewport: BrowserViewport, frame: (frame: BrowserFrame) => void,
    disconnected: () => void, signal: AbortSignal, changed: (snapshot: BrowserSnapshot) => void = () => undefined
  ): Promise<BrowserWatch> {
    const previous = this.#watching;
    const watching: Watching = { viewport, frame, disconnected, changed, current: null };
    this.#watching = watching;
    previous?.disconnected();
    try {
      await this.snapshot(signal);
      await this.#restartCast(signal);
    } catch (error) {
      if (this.#watching === watching) {
        this.#watching = null;
      }
      throw error;
    }
    return {
      ack: async (sequence) => { await watching.current?.ack(sequence); },
      close: async () => {
        if (this.#watching === watching) {
          this.#watching = null;
          await this.#restartCast(AbortSignal.timeout(RELEASE_TIMEOUT_MS));
        }
      },
    };
  }

  #restartCast(signal: AbortSignal): Promise<void> {
    const watching = this.#watching;
    const tabId = this.#active;
    return this.#queueCast(async () => {
      if (this.#watching === watching && this.#active === tabId) {
        await this.#replaceCast(signal);
      }
    });
  }

  #queueCast(work: () => Promise<void>): Promise<void> {
    const result = this.#castTail.then(work);
    // 各调用者收到本次失败；后一次重连仍能进队列。
    this.#castTail = result.catch(() => { this.#casting = null; });
    return result;
  }

  async #stopCast(targetGone = false): Promise<void> {
    const casting = this.#casting;
    this.#casting = null;
    this.#castingTabId = null;
    const previous = casting?.current;
    if (casting !== null) {
      casting.current = null;
    }
    await previous?.close(targetGone);
  }

  async #replaceCast(signal: AbortSignal): Promise<void> {
    if (this.#casting !== null && this.#casting === this.#watching && this.#castingTabId === this.#active) {
      return;
    }
    await this.#stopCast();
    signal.throwIfAborted();
    const watching = this.#watching;
    if (watching === null || this.#active === null) {
      return;
    }
    const tabId = this.#active;
    const { connection, sessionId } = await this.#session(tabId, signal);
    await connection.send('Target.activateTarget', { targetId: tabId }, signal);
    const current = await screencast({ connection, sessionId, tabId, ...watching.viewport,
      sequence: () => ++this.#sequence, frame: (frame) => {
        if (this.#watching === watching && this.#active === tabId) {
          watching.frame(frame);
        }
      }, signal,
      failed: () => this.#connection?.close() });
    if (this.#watching !== watching || this.#active !== tabId) {
      await current.close();
      return;
    }
    watching.current = current;
    this.#casting = watching;
    this.#castingTabId = tabId;
  }

  close(): void {
    this.#lifetime.abort();
    this.#connection?.close();
  }

  disconnect(): void { this.#connection?.close(); }
}
