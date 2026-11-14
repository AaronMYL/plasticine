// 界面 → 壳的 ipc：每条都先认人（只收界面视图里本站主 frame 发的；开始页只能用「本体跑在哪」那两条），再按共享 schema
// 校验参数，不过就丢掉并记一笔，不往下做。本机令牌另按发起方当前地址核一次（只给本机同源）。壳 → 界面的事件在
// ui-events.ts。

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { Value } from 'typebox/value';
import { DESKTOP_PERMISSIONS, DevicePairRequestSchema, ServerChoiceSchema, type DesktopPermission,
  type DevicePairRequest, type ServerChoice } from '../../../agent/shared/api/desktop-bridge.ts';
import { LoginImportRequestSchema, type LoginImportRequest } from '../../../agent/shared/api/mac-logins.ts';
import { WEB_TAB_COMMANDS, type WebTabsSync }
  from '../../../agent/shared/api/mac-bridge.ts';
import { TranslateDeliverySchema, TranslatePageConfigSchema, type TranslateDelivery, type TranslatePageConfig }
  from '../../../agent/shared/api/mac-translate.ts';
import { WebPageToolSchema, type WebPageTool } from '../../../agent/shared/api/web-page-tools.ts';
import { HELPER_METHODS, isHelperMethod, type HelperMethod } from '../../../agent/shared/desktop-helper-protocol.ts';
import { readSync } from '../tabs/tab-sync.ts';
import { CHANNELS } from './channels.ts';

/** 通知的标题、正文、hash 上限：一行标题、几行正文就够，再长是出错了。 */
const NOTIFY_TITLE_MAX = 200;
const NOTIFY_BODY_MAX = 2_000;
const HASH_MAX = 500;
const TAB_ID_MAX = 100;
const URL_MAX = 4_096;
/** 等登录回调的端口：只收非特权端口（Codex 是 1455）。 */
const CAPTURE_PORT_MIN = 1024;
const CAPTURE_PORT_MAX = 65_535;

export interface ShellServices {
  info(): { version: string; platform: 'macos' | 'windows' | 'linux'; tools: string[] };
  /** 界面视图和它现在该载入的源地址；开始页的地址另算。 */
  ui(): WebContents;
  allowedOrigin(): string | null;
  startPage(): string;
  notify(title: string, body: string, hash: string): void;
  notificationsEnabled(): boolean;
  setNotifications(enabled: boolean): boolean;
  /** 第13批：发一条测试通知，等系统回话（notify-test.ts）。 */
  testNotification(): Promise<unknown>;
  /** 打开系统的通知设置页。 */
  openNotificationSettings(): void;
  serverStatus(): unknown;
  chooseServer(choice: ServerChoice): Promise<unknown>;
  /** 本机令牌：frameUrl 是发起方主 frame 当前的地址，不是本机同源回 null（account-client.ts 的 localGrantFor）。 */
  localGrant(frameUrl: string): string | null;
  showWelcome(): void;
  /** 第一次的引导要的系统全名和笔记应用（host-profile.ts）；frameUrl 不是本机同源回 null，规矩同 localGrant。 */
  profile(frameUrl: string): Promise<unknown>;
  openExternal(url: string): void;
  capture(port: number, timeoutMs: number): Promise<string | null>;
  cancelCapture(): void;
  updateStatus(): unknown;
  updateCheck(): Promise<unknown>;
  updateDownload(): Promise<unknown>;
  updateInstall(): void;
  updateRollback(): void;
  deviceStatus(): unknown;
  devicePair(request: DevicePairRequest): Promise<unknown>;
  devicePause(paused: boolean): unknown;
  openPermission(permission: DesktopPermission): void;
  /** 界面直接调系统助手（client/src/mac/desktop-helper.ts）：只放行协议里的方法，参数先过 schema。 */
  helperCall(method: HelperMethod, params: Record<string, unknown>): Promise<unknown>;
  chromeCurrent(): unknown;
  tabsSync(state: WebTabsSync): void;
  tabsCommand(tabId: string, command: string): void;
  tabsNavigate(tabId: string, url: string): void;
  tabsSnapshot(tabId: string): Promise<unknown>;
  tabsTool(tabId: string, tool: WebPageTool): Promise<unknown>;
  tabsInput(input: Record<string, unknown>): void;
  translateConfigure(tabId: string, config: TranslatePageConfig | null): void;
  translateDeliver(tabId: string, delivery: TranslateDelivery): void;
  loginsSites(): Promise<unknown>;
  loginsSources(): Promise<unknown>;
  loginsImport(request: LoginImportRequest): Promise<unknown>;
  loginsForget(host: string): Promise<unknown>;
  openFullDiskAccess(): void;
  log(line: string): void;
}

type Sender = IpcMainEvent | IpcMainInvokeEvent;

/** 交给系统浏览器的只收 http(s) 网址。 */
export function webAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** 消息是不是界面视图里本站主 frame 发的。startPage：开始页也算（只给「本体跑在哪」那两条用）。 */
function trusted(services: ShellServices, event: Sender, startPage = false): boolean {
  const frame = event.senderFrame;
  if (event.sender !== services.ui() || frame === null || frame.parent !== null) {
    return false;
  }
  if (startPage && frame.url.startsWith(services.startPage())) {
    return true;
  }
  const origin = services.allowedOrigin();
  try {
    return origin !== null && new URL(frame.url).origin === new URL(origin).origin;
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

export function registerBridge(services: ShellServices): void {
  const on = (channel: string, handle: (...args: unknown[]) => void): void => {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      if (!trusted(services, event)) {
        services.log(`丢掉一条不是界面本站发的消息（${channel}）。`);
        return;
      }
      handle(...args);
    });
  };
  const handle = (channel: string, run: (...args: unknown[]) => unknown, startPage = false): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(services, event, startPage)) {
        throw new Error('不是界面本站发的请求。');
      }
      return run(...args);
    });
  };
  const invalid = (channel: string): never => {
    throw new Error(`${channel} 的参数不对。`);
  };

  ipcMain.on(CHANNELS.info, (event) => {
    event.returnValue = trusted(services, event, true) ? services.info() : null;
  });
  ipcMain.on(CHANNELS.chromeCurrent, (event) => {
    event.returnValue = trusted(services, event, true) ? services.chromeCurrent() : null;
  });
  on(CHANNELS.notify, (title, body, hash) => {
    if (text(title, NOTIFY_TITLE_MAX) && typeof body === 'string' && body.length <= NOTIFY_BODY_MAX
      && typeof hash === 'string' && hash.length <= HASH_MAX) {
      services.notify(title, body, hash);
    }
  });
  handle(CHANNELS.notificationsEnabled, () => services.notificationsEnabled());
  handle(CHANNELS.notificationsTest, () => services.testNotification());
  on(CHANNELS.notificationsSettings, () => {
    services.openNotificationSettings();
  });
  handle(CHANNELS.notificationsSet, (enabled) => (typeof enabled === 'boolean'
    ? services.setNotifications(enabled) : invalid(CHANNELS.notificationsSet)));
  handle(CHANNELS.serverStatus, () => services.serverStatus(), true);
  handle(CHANNELS.serverChoose, (choice) => (Value.Check(ServerChoiceSchema, choice)
    ? services.chooseServer(choice) : invalid(CHANNELS.serverChoose)), true);
  ipcMain.handle(CHANNELS.serverLocalGrant, (event) => (trusted(services, event)
    ? services.localGrant(event.senderFrame?.url ?? '') : null));
  on(CHANNELS.serverWelcome, () => services.showWelcome());
  ipcMain.handle(CHANNELS.serverProfile, (event) => (trusted(services, event)
    ? services.profile(event.senderFrame?.url ?? '') : null));
  on(CHANNELS.externalOpen, (url) => {
    if (text(url, URL_MAX) && webAddress(url)) {
      services.openExternal(url);
    } else {
      services.log('丢掉一个不是 http(s) 的外部链接。');
    }
  });
  handle(CHANNELS.externalCapture, (port, timeoutMs) => (Number.isInteger(port) && Number(port) >= CAPTURE_PORT_MIN
    && Number(port) <= CAPTURE_PORT_MAX && Number.isInteger(timeoutMs) && Number(timeoutMs) > 0
    ? services.capture(Number(port), Number(timeoutMs)) : invalid(CHANNELS.externalCapture)));
  on(CHANNELS.externalCancel, () => services.cancelCapture());
  handle(CHANNELS.updateStatus, () => services.updateStatus());
  handle(CHANNELS.updateCheck, () => services.updateCheck());
  handle(CHANNELS.updateDownload, () => services.updateDownload());
  on(CHANNELS.updateInstall, () => services.updateInstall());
  on(CHANNELS.updateRollback, () => services.updateRollback());
  handle(CHANNELS.deviceStatus, () => services.deviceStatus());
  handle(CHANNELS.devicePair, (request) => (Value.Check(DevicePairRequestSchema, request)
    ? services.devicePair(request) : invalid(CHANNELS.devicePair)));
  handle(CHANNELS.devicePause, (paused) => (typeof paused === 'boolean'
    ? services.devicePause(paused) : invalid(CHANNELS.devicePause)));
  on(CHANNELS.devicePermission, (permission) => {
    if ((DESKTOP_PERMISSIONS as readonly unknown[]).includes(permission)) {
      services.openPermission(permission as DesktopPermission);
    }
  });
  handle(CHANNELS.helperCall, (method, params) => {
    const name = typeof method === 'string' ? method : '';
    if (!isHelperMethod(name) || name === 'cancel' || !Value.Check(HELPER_METHODS[name].params, params ?? {})) {
      return invalid(CHANNELS.helperCall);
    }
    return services.helperCall(name, (params ?? {}) as Record<string, unknown>);
  });
  on(CHANNELS.tabsSync, (state) => {
    const { sync, dropped } = readSync(state);
    if (dropped > 0) {
      services.log(`网页标签清单里有 ${dropped} 个标签的网址不对，跳过了它们。`);
    }
    if (sync === null) {
      services.log('网页标签清单的形状不对，没用。');
    } else {
      services.tabsSync(sync);
    }
  });
  on(CHANNELS.tabsCommand, (tabId, command) => {
    if (text(tabId, TAB_ID_MAX) && (WEB_TAB_COMMANDS as readonly unknown[]).includes(command)) {
      services.tabsCommand(tabId, String(command));
    }
  });
  on(CHANNELS.tabsNavigate, (tabId, url) => {
    if (text(tabId, TAB_ID_MAX) && text(url, URL_MAX) && /^https?:\/\//i.test(url)) {
      services.tabsNavigate(tabId, url);
    }
  });
  handle(CHANNELS.tabsSnapshot, (tabId) => (text(tabId, TAB_ID_MAX) ? services.tabsSnapshot(tabId)
    : invalid(CHANNELS.tabsSnapshot)));
  handle(CHANNELS.tabsTool, (tabId, tool) => (text(tabId, TAB_ID_MAX) && Value.Check(WebPageToolSchema, tool)
    ? services.tabsTool(tabId, tool) : invalid(CHANNELS.tabsTool)));
  on(CHANNELS.tabsInput, (input) => {
    if (typeof input === 'object' && input !== null && typeof (input as { x?: unknown }).x === 'number') {
      services.tabsInput(input as Record<string, unknown>);
    }
  });
  on(CHANNELS.translateConfigure, (tabId, config) => {
    if (text(tabId, TAB_ID_MAX) && (config === null || Value.Check(TranslatePageConfigSchema, config))) {
      services.translateConfigure(tabId, config);
    }
  });
  on(CHANNELS.translateDeliver, (tabId, delivery) => {
    if (text(tabId, TAB_ID_MAX) && Value.Check(TranslateDeliverySchema, delivery)) {
      services.translateDeliver(tabId, delivery);
    }
  });
  handle(CHANNELS.loginsSites, () => services.loginsSites());
  handle(CHANNELS.loginsSources, () => services.loginsSources());
  handle(CHANNELS.loginsImport, (request) => (Value.Check(LoginImportRequestSchema, request)
    ? services.loginsImport(request) : invalid(CHANNELS.loginsImport)));
  handle(CHANNELS.loginsForget, (host) => (text(host, 253) ? services.loginsForget(host)
    : invalid(CHANNELS.loginsForget)));
  on(CHANNELS.loginsFullDisk, () => services.openFullDiskAccess());
}
