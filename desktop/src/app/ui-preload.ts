// 界面（Plasticine 本站网页）的 preload：contextIsolation + sandbox，只经 contextBridge 暴露那一份接口
// （agent/shared/api/desktop-bridge.ts 的 PlasticineDesktopBridge，挂在 window.plasticineDesktop）。另外两件只能在这里做的事：
// - 顶栏拖动区：界面报 titlebar 布局，这里在页面最上层放一层不接鼠标的 -webkit-app-region 区域（顶栏可拖、按钮不拖）。
// - 网页标签垫在界面下面时（tab-layering.ts），落在网页标签那一块、不在浮层里的鼠标事件截下来转给主进程。

import { contextBridge, ipcRenderer } from 'electron';
import type { DevicePairRequest, DesktopPermission, PlasticineDesktopExternal, PlasticineDesktopServer,
  ServerChoice } from '../../../agent/shared/api/desktop-bridge.ts';
import type { LoginImportRequest } from '../../../agent/shared/api/mac-logins.ts';
import type { TitlebarLayout, WebTabCommand, WebTabsSync } from '../../../agent/shared/api/mac-bridge.ts';
import type { TranslateDelivery, TranslatePageConfig } from '../../../agent/shared/api/mac-translate.ts';
import type { WebPageTool } from '../../../agent/shared/api/web-page-tools.ts';
import { forwardsToTab } from '../tabs/tab-layering.ts';
import { CHANNELS } from './channels.ts';

interface ShellInfo {
  version: string;
  platform: 'macos' | 'windows' | 'linux';
  tools: string[];
}

// 不是本站（或开始页）的网页拿到的是 null：什么都不暴露。
const shellInfo = ipcRenderer.sendSync(CHANNELS.info) as ShellInfo | null;
const info: ShellInfo = shellInfo ?? { version: '', platform: 'linux', tools: [] };
const DRAG_HOST = 'plasticine-titlebar';
/** 主进程报的网页标签光标（Electron 的叫法）→ CSS 的叫法。 */
const CURSORS: Readonly<Record<string, string>> = { pointer: 'default', hand: 'pointer', text: 'text', wait: 'wait',
  crosshair: 'crosshair', help: 'help', move: 'move', progress: 'progress', grab: 'grab', grabbing: 'grabbing' };

let lastSync: WebTabsSync | null = null;
let tabCursor = 'default';
let cursorTaken = false;

function chromeCurrent(): unknown {
  const current = ipcRenderer.sendSync(CHANNELS.chromeCurrent) as { trafficLightInset: number; fullScreen: boolean };
  if (info.platform !== 'windows') {
    return current;
  }
  const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean;
    getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay;
  if (overlay === undefined || !overlay.visible) {
    return current;
  }
  const area = overlay.getTitlebarAreaRect();
  return { ...current, controlsRight: Math.max(0, Math.round(window.innerWidth - (area.x + area.width))) };
}

/** 顶栏拖动区：整条顶栏可拖，按钮、标签、地址栏这些 noDrag 矩形不拖；这一层不接鼠标，只给系统看。 */
function applyTitlebar(layout: TitlebarLayout): void {
  let host = document.querySelector<HTMLElement>(DRAG_HOST);
  if (host === null) {
    host = document.createElement(DRAG_HOST);
    host.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(host);
  }
  host.style.cssText = `position:fixed;left:0;top:0;right:0;height:${layout.height}px;z-index:2147483647;`
    + 'pointer-events:none;-webkit-app-region:drag;';
  host.replaceChildren(...layout.noDrag.map((rect) => {
    const hole = document.createElement('div');
    hole.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;`
      + `height:${rect.height}px;pointer-events:none;-webkit-app-region:no-drag;`;
    return hole;
  }));
}

function modifiers(event: MouseEvent): string[] {
  const list: string[] = [];
  if (event.shiftKey) { list.push('shift'); }
  if (event.ctrlKey) { list.push('control'); }
  if (event.altKey) { list.push('alt'); }
  if (event.metaKey) { list.push('meta'); }
  if ((event.buttons & 1) !== 0) { list.push('leftButtonDown'); }
  if ((event.buttons & 2) !== 0) { list.push('rightButtonDown'); }
  return list;
}

const BUTTONS = ['left', 'middle', 'right'] as const;

function forward(event: MouseEvent): void {
  const sync = lastSync;
  const inside = sync !== null && forwardsToTab(event.clientX, event.clientY, sync.frame, sync.hitRegions);
  if (event.type === 'mousemove') {
    if (inside !== cursorTaken) {
      document.documentElement.style.cursor = inside ? tabCursor : '';
      cursorTaken = inside;
    }
  }
  if (!inside) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const base = { x: event.clientX, y: event.clientY, modifiers: modifiers(event) };
  if (event instanceof WheelEvent) {
    ipcRenderer.send(CHANNELS.tabsInput, { ...base, type: 'mouseWheel', deltaX: -event.deltaX, deltaY: -event.deltaY,
      canScroll: true });
    return;
  }
  const type = event.type === 'mousedown' ? 'mouseDown' : event.type === 'mouseup' ? 'mouseUp' : 'mouseMove';
  ipcRenderer.send(CHANNELS.tabsInput, { ...base, type, button: BUTTONS[event.button] ?? 'left',
    clickCount: event.detail === 0 ? 1 : event.detail });
}

for (const name of ['mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu'] as const) {
  window.addEventListener(name, (event) => {
    if (name === 'contextmenu') {
      const sync = lastSync;
      if (sync !== null && forwardsToTab(event.clientX, event.clientY, sync.frame, sync.hitRegions)) {
        event.preventDefault();
      }
      return;
    }
    forward(event);
  }, { capture: true, passive: false });
}

ipcRenderer.on(CHANNELS.tabsCursor, (_event, type: string) => {
  tabCursor = CURSORS[type] ?? 'default';
  if (cursorTaken) {
    document.documentElement.style.cursor = tabCursor;
  }
});

const webTabs = {
  sync(state: WebTabsSync): void {
    lastSync = JSON.parse(JSON.stringify(state)) as WebTabsSync;
    ipcRenderer.send(CHANNELS.tabsSync, state);
  },
  command: (tabId: string, command: WebTabCommand): void => ipcRenderer.send(CHANNELS.tabsCommand, tabId, command),
  navigate: (tabId: string, url: string): void => ipcRenderer.send(CHANNELS.tabsNavigate, tabId, url),
  snapshot: (tabId: string): Promise<unknown> => ipcRenderer.invoke(CHANNELS.tabsSnapshot, tabId),
  tools: info.tools,
  tool: (tabId: string, tool: WebPageTool): Promise<unknown> => ipcRenderer.invoke(CHANNELS.tabsTool, tabId, tool),
};

const bridge = {
  version: info.version,
  platform: info.platform,
  notify: (title: string, body: string, hash: string): void => ipcRenderer.send(CHANNELS.notify, title, body, hash),
  notifications: {
    enabled: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.notificationsEnabled),
    setEnabled: (enabled: boolean): Promise<unknown> => ipcRenderer.invoke(CHANNELS.notificationsSet, enabled),
  },
  webTabs,
  windowChrome: {
    current: chromeCurrent,
    titlebar(layout: TitlebarLayout): void {
      applyTitlebar(layout);
      ipcRenderer.send(CHANNELS.chromeTitlebar, layout);
    },
  },
  translate: {
    configure: (tabId: string, config: TranslatePageConfig | null): void =>
      ipcRenderer.send(CHANNELS.translateConfigure, tabId, config),
    deliver: (tabId: string, delivery: TranslateDelivery): void =>
      ipcRenderer.send(CHANNELS.translateDeliver, tabId, delivery),
  },
  logins: {
    sites: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.loginsSites),
    sources: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.loginsSources),
    import: (request: LoginImportRequest): Promise<unknown> => ipcRenderer.invoke(CHANNELS.loginsImport, request),
    forget: (host: string): Promise<unknown> => ipcRenderer.invoke(CHANNELS.loginsForget, host),
    openFullDiskAccess: (): void => ipcRenderer.send(CHANNELS.loginsFullDisk),
  },
  server: {
    status: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.serverStatus),
    choose: (choice: ServerChoice): Promise<unknown> => ipcRenderer.invoke(CHANNELS.serverChoose, choice),
    localGrant: async (): Promise<string | null> => {
      const grant: unknown = await ipcRenderer.invoke(CHANNELS.serverLocalGrant);
      return typeof grant === 'string' ? grant : null;
    },
    showWelcome: (): void => ipcRenderer.send(CHANNELS.serverWelcome),
  } satisfies PlasticineDesktopServer,
  external: {
    open: (url: string): void => ipcRenderer.send(CHANNELS.externalOpen, url),
    capture: async (port: number, timeoutMs: number): Promise<string | null> => {
      const captured: unknown = await ipcRenderer.invoke(CHANNELS.externalCapture, port, timeoutMs);
      return typeof captured === 'string' ? captured : null;
    },
    cancelCapture: (): void => ipcRenderer.send(CHANNELS.externalCancel),
  } satisfies PlasticineDesktopExternal,
  updates: {
    status: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.updateStatus),
    check: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.updateCheck),
    install: (): void => ipcRenderer.send(CHANNELS.updateInstall),
    rollback: (): void => ipcRenderer.send(CHANNELS.updateRollback),
  },
  device: {
    status: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.deviceStatus),
    pair: (request: DevicePairRequest): Promise<unknown> => ipcRenderer.invoke(CHANNELS.devicePair, request),
    pause: (paused: boolean): Promise<unknown> => ipcRenderer.invoke(CHANNELS.devicePause, paused),
    openPermission: (permission: DesktopPermission): void => ipcRenderer.send(CHANNELS.devicePermission, permission),
  },
  helper: {
    call: (method: string, params: Record<string, unknown>): Promise<unknown> =>
      ipcRenderer.invoke(CHANNELS.helperCall, method, params),
  },
};

if (shellInfo !== null) {
  contextBridge.exposeInMainWorld('plasticineDesktop', bridge);
}
