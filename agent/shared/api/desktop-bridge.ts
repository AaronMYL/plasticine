// 桌面客户端（Mac、Windows 共用一套 Electron 壳，《优化清单》第 14 条，他 11-06 定）和网页界面之间的接口：两端实现
// 同一份，界面只认这一个入口（window.plasticineDesktop；11-08 整合后不再挂旧名字 window.plasticineMac）。
// 网页标签、窗口外观、翻译、登录沿用 mac-bridge.ts / mac-translate.ts / mac-logins.ts / web-page-tools.ts 的形状，
// 这里只加 Electron 壳新有的几样：本体跑在哪（这台电脑 / 远程，设置 · 系统里切换）、客户端更新、让 Plasticine 用这台
// 电脑（设备服务的配对和暂停）、系统通知开关。
//
// 网页 → 壳：window.plasticineDesktop 的方法，经 Electron 的 ipc 走（preload 里 contextBridge 暴露，只收界面本站主 frame
//   的消息）。回 Promise 的都回未校验的数据，界面按下面的 schema 校验后再用。
// 壳 → 网页：window.__plasticineWebTabEvent / __plasticineTranslateEvent / __plasticineWindowChrome / __plasticineWebMenu
//   照旧（形状在各自的文件里），新加一个 window.__plasticineDesktopEvent(DesktopEvent)：本体、更新、设备的状态变了。

import { Type, type Static } from 'typebox';
import { IsoTimeSchema } from './common.ts';
import type { PlasticineMacLogins } from './mac-logins.ts';
import type { PlasticineMacTranslate } from './mac-translate.ts';
import type { PlasticineMacWebTabs, PlasticineMacWindowChrome } from './mac-bridge.ts';

const STRICT = { additionalProperties: false };

export const DESKTOP_PLATFORMS = ['macos', 'windows', 'linux'] as const;
export const DesktopPlatformSchema = Type.Enum(DESKTOP_PLATFORMS);
export type DesktopPlatform = Static<typeof DesktopPlatformSchema>;

/** 本体跑在哪：这台电脑（壳拉起并守着自带的本体）或远程地址（自己的服务器）。切换不搬数据，两边的数据各是各的。 */
export const SERVER_MODES = ['this_computer', 'remote'] as const;
export const ServerModeSchema = Type.Enum(SERVER_MODES);
export type ServerMode = Static<typeof ServerModeSchema>;

/** 远程地址只收 https 的源地址（可带端口），和 Mac 壳一样不带路径、查询、账号。 */
export const REMOTE_URL_MAX_CHARS = 300;

export const ServerChoiceSchema = Type.Object({
  mode: ServerModeSchema,
  /** 远程地址；选这台电脑时也留着上次填的，切回去不用重填。没填过是 null。 */
  remoteUrl: Type.Union([Type.String({ minLength: 1, maxLength: REMOTE_URL_MAX_CHARS }), Type.Null()]),
}, STRICT);
export type ServerChoice = Static<typeof ServerChoiceSchema>;

export const LOCAL_SERVER_STATES = ['stopped', 'starting', 'running', 'failed', 'absent'] as const;
export type LocalServerState = (typeof LOCAL_SERVER_STATES)[number];

export const ServerStatusSchema = Type.Object({
  choice: ServerChoiceSchema,
  /** 这个安装包带没带本体：没带只能选远程。 */
  bundled: Type.Boolean(),
  /** 这台电脑上本体的状态；选远程时是 stopped，没带本体是 absent。 */
  local: Type.Enum(LOCAL_SERVER_STATES),
  /** 本机本体没起来、重启中时的一句原因；正常是 null。 */
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  /** 窗口现在载入的地址（源地址）。 */
  loaded: Type.String({ maxLength: REMOTE_URL_MAX_CHARS }),
}, STRICT);
export type ServerStatus = Static<typeof ServerStatusSchema>;

/** available：查到新版、还没下（11-12 Aaron 定：点了才下）；点了 downloading → ready → installing（客户端重开）。 */
export const UPDATE_STATES = ['idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'failed',
  'up_to_date'] as const;

export const UpdateStatusSchema = Type.Object({
  /** 客户端自己的版本（发布版本号，年.月日.时分秒；开发时是 0.0.0）。 */
  version: Type.String({ maxLength: 40 }),
  state: Type.Enum(UPDATE_STATES),
  /** 发布点上更新的那一版；没有是 null。 */
  available: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  /** 可以一步退回的上一版；没有是 null。 */
  previous: Type.Union([Type.String({ maxLength: 40 }), Type.Null()]),
  checkedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** 没装上、被退回时的一句原因（「这一版启动后没答上，已退回 2026.1107.…」）。 */
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
  /** 正在下的那一版下了多少（字节）；没在下是 null（侧栏更新按钮的圆形进度，11-12）。 */
  progress: Type.Optional(Type.Union([Type.Object({ received: Type.Integer({ minimum: 0 }),
    total: Type.Integer({ minimum: 0 }) }, STRICT), Type.Null()])),
}, STRICT);
export type UpdateStatus = Static<typeof UpdateStatusSchema>;

export const DEVICE_SERVICE_STATES = ['unpaired', 'connecting', 'online', 'paused', 'repair', 'offline'] as const;

/** 让 Plasticine 用这台电脑：文件、命令、截屏和点按、日历、提醒事项（设计稿 Settings-System 最后一行）。 */
export const DeviceServiceStatusSchema = Type.Object({
  state: Type.Enum(DEVICE_SERVICE_STATES),
  /** 配对到的本体源地址；没配对是 null。 */
  server: Type.Union([Type.String({ maxLength: REMOTE_URL_MAX_CHARS }), Type.Null()]),
  /** 这台电脑会做的事（共享 schema 的 DeviceActionKind 名字）。 */
  capabilities: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 64 }),
  /** 系统权限没给的几样（截屏、辅助功能、日历、提醒事项）：界面列出来，点了打开系统设置。 */
  missing: Type.Array(Type.Enum(['screen', 'accessibility', 'calendar', 'reminders']), { maxItems: 4 }),
  problem: Type.Union([Type.String({ maxLength: 300 }), Type.Null()]),
}, STRICT);
export type DeviceServiceStatus = Static<typeof DeviceServiceStatusSchema>;

/** 配对码（网页「设置 → 系统 → 设备 → 添加设备」生成的那一串）。 */
export const DevicePairRequestSchema = Type.Object({ code: Type.String({ minLength: 4, maxLength: 20 }) }, STRICT);
export type DevicePairRequest = Static<typeof DevicePairRequestSchema>;

export const DesktopEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('server'), status: ServerStatusSchema }, STRICT),
  Type.Object({ type: Type.Literal('update'), status: UpdateStatusSchema }, STRICT),
  Type.Object({ type: Type.Literal('device'), status: DeviceServiceStatusSchema }, STRICT),
]);
export type DesktopEvent = Static<typeof DesktopEventSchema>;

/**
 * 网页标签的网站图标（11-08 他要标签显示真的网站图标）：壳听 page-favicon-updated，用标签自己的 session 取第一个
 * 能用的图标，转成 data: 地址（图片类型、最多 WEB_TAB_ICON_MAX_BYTES 字节），经 window.__plasticineWebTabEvent 报
 * { type: 'icon', tabId, pageUrl, icon }。和 mac-bridge.ts 的 WebTabEvent 同一个入口；整合时并进那个联合类型。
 */
export const WEB_TAB_ICON_MAX_BYTES = 64 * 1024;
export const WEB_TAB_ICON_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml',
  'image/jpeg', 'image/gif', 'image/webp'] as const;

export const WebTabIconEventSchema = Type.Object({
  type: Type.Literal('icon'),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  /** 图标属于哪一页（标签换了页、旧图标晚到时界面据此丢掉）。 */
  pageUrl: Type.String({ maxLength: 4_096 }),
  icon: Type.String({ pattern: '^data:image/', maxLength: Math.ceil(WEB_TAB_ICON_MAX_BYTES / 3) * 4 + 100 }),
}, STRICT);
export type WebTabIconEvent = Static<typeof WebTabIconEventSchema>;

/** 权限名 → 打开哪一页系统设置。 */
export const DESKTOP_PERMISSIONS = ['screen', 'accessibility', 'calendar', 'reminders', 'notifications'] as const;
export type DesktopPermission = (typeof DESKTOP_PERMISSIONS)[number];

/**
 * 第一次的引导里认哪几个笔记应用（2026-11-12《首次使用解耦》）：装了就推「导入 xx 笔记」。壳只回认出来的这几个，
 * 不回别的应用名，也不读它们的内容。
 */
export const ONBOARDING_APPS = ['obsidian', 'notion', 'bear', 'evernote', 'logseq', 'apple-notes'] as const;
export type OnboardingApp = (typeof ONBOARDING_APPS)[number];

/** 这台电脑的系统全名（引导卡里「叫你什么」预填）和认出来的笔记应用。 */
export const HostProfileSchema = Type.Object({
  fullName: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
  apps: Type.Array(Type.Enum(ONBOARDING_APPS), { maxItems: ONBOARDING_APPS.length }),
}, STRICT);
export type HostProfile = Static<typeof HostProfileSchema>;

export interface PlasticineDesktopServer {
  /** 回 ServerStatusSchema（未校验）。 */
  status(): Promise<unknown>;
  /** 换本体跑在哪：存下、停或起本机本体、窗口载入新地址（界面会重新加载）。回 ServerStatusSchema。 */
  choose(choice: ServerChoice): Promise<unknown>;
  /**
   * 首次使用流程（11-08）：界面载入的是壳自己拉起的本机本体时，给本机令牌（请求头 LOCAL_TOKEN_HEADER 用，
   * agent/shared/api/account.ts）；连远程或不在本站时是 null。建账号页凭它建账号，设置 · 账号凭它不问旧密码改密码。
   */
  localGrant(): Promise<string | null>;
  /** 回到开始页（「在哪里用 Plasticine？」二选一）：登录页的「换一个地方」、菜单「连接到…」都走这里。 */
  showWelcome(): void;
  /** 第一次的引导用：回 HostProfileSchema（未校验）；界面载入的不是本机本体时回 null，和 localGrant 同一条规矩。 */
  profile(): Promise<unknown>;
}

/**
 * 站外链接交给系统浏览器（11-08：模型订阅登录在桌面客户端里直接开系统浏览器）。只收 http(s)；要在点击里调。
 * capture：在本机 127.0.0.1:<port> 上等一次 OAuth 回调（连远程实例时，浏览器跳回的 localhost 在这台电脑上），
 * 拿到就回完整的回调地址，超时或取消回 null；界面再把它交给本体已有的「贴回调地址」接口。
 */
export interface PlasticineDesktopExternal {
  open(url: string): void;
  capture(port: number, timeoutMs: number): Promise<string | null>;
  cancelCapture(): void;
}

export interface PlasticineDesktopUpdates {
  /** 回 UpdateStatusSchema。 */
  status(): Promise<unknown>;
  /** 马上查一次；有新版只报 available，不下载（11-12），回 UpdateStatusSchema。 */
  check(): Promise<unknown>;
  /** 下 available 的那一版并核对；下载中照常报进度。下好回 ready 的 UpdateStatusSchema，没成回 failed。 */
  download(): Promise<unknown>;
  /** 装上已下好的新版并重新打开客户端。 */
  install(): void;
  /** 退回上一版并重新打开客户端。 */
  rollback(): void;
}

export interface PlasticineDesktopDevice {
  /** 回 DeviceServiceStatusSchema。 */
  status(): Promise<unknown>;
  /** 用配对码把这台电脑配给现在载入的本体；回 DeviceServiceStatusSchema。 */
  pair(request: DevicePairRequest): Promise<unknown>;
  /** 暂停 / 接着让 Plasticine 用这台电脑。 */
  pause(paused: boolean): Promise<unknown>;
  /** 打开系统设置里对应的那一页（截屏、辅助功能、日历、提醒事项、通知）。 */
  openPermission(permission: DesktopPermission): void;
}

/** 窗口外观在 Windows 上多报一项：右上角窗口按钮让出来的宽度（和 shell 线给 WindowChromeSchema 加的同名字段对齐）。 */
export interface DesktopWindowChrome {
  trafficLightInset: number;
  fullScreen: boolean;
  controlsRight?: number;
}

/**
 * 界面直接调系统助手（machelper 线的 client/src/mac/desktop-helper.ts 按这个取）：方法和参数照
 * agent/shared/desktop-helper-protocol.ts 的 HELPER_METHODS，壳只放行那里的方法（cancel 除外），参数先过 schema。
 */
export interface PlasticineDesktopHelper {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface PlasticineDesktopBridge {
  version: string;
  platform: DesktopPlatform;
  notify(title: string, body: string, hash: string): void;
  /** 系统通知开关（设置 · 系统）；关着时 notify 不弹。 */
  notifications: { enabled(): Promise<unknown>; setEnabled(enabled: boolean): Promise<unknown> };
  webTabs: PlasticineMacWebTabs;
  windowChrome: PlasticineMacWindowChrome;
  translate: PlasticineMacTranslate;
  logins: PlasticineMacLogins;
  server: PlasticineDesktopServer;
  updates: PlasticineDesktopUpdates;
  device: PlasticineDesktopDevice;
  helper: PlasticineDesktopHelper;
  external: PlasticineDesktopExternal;
}
