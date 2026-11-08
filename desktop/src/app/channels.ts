// 界面（preload）和主进程之间的 ipc 通道名。两边都从这里取，不手写字符串。

export const CHANNELS = {
  info: 'desktop:info',
  notify: 'desktop:notify',
  notificationsEnabled: 'desktop:notifications-enabled',
  notificationsSet: 'desktop:notifications-set',
  serverStatus: 'desktop:server-status',
  serverChoose: 'desktop:server-choose',
  serverLocalGrant: 'desktop:server-local-grant',
  serverWelcome: 'desktop:server-welcome',
  externalOpen: 'desktop:external-open',
  externalCapture: 'desktop:external-capture',
  externalCancel: 'desktop:external-cancel',
  updateStatus: 'desktop:update-status',
  updateCheck: 'desktop:update-check',
  updateInstall: 'desktop:update-install',
  updateRollback: 'desktop:update-rollback',
  deviceStatus: 'desktop:device-status',
  devicePair: 'desktop:device-pair',
  devicePause: 'desktop:device-pause',
  devicePermission: 'desktop:device-permission',
  helperCall: 'desktop:helper-call',
  chromeCurrent: 'chrome:current',
  chromeTitlebar: 'chrome:titlebar',
  tabsSync: 'tabs:sync',
  tabsCommand: 'tabs:command',
  tabsNavigate: 'tabs:navigate',
  tabsSnapshot: 'tabs:snapshot',
  tabsTool: 'tabs:tool',
  tabsInput: 'tabs:input',
  tabsCursor: 'tabs:cursor',
  translateConfigure: 'translate:configure',
  translateDeliver: 'translate:deliver',
  loginsSites: 'logins:sites',
  loginsSources: 'logins:sources',
  loginsImport: 'logins:import',
  loginsForget: 'logins:forget',
  loginsFullDisk: 'logins:full-disk',
} as const;

/** 网页标签里的 preload 和主进程之间（注入脚本的消息、主进程叫脚本做事）。 */
export const TAB_CHANNELS = {
  /** 主进程 → 标签：叫页面脚本做一件事，{ id, op, args }；标签回 tab:reply { id, ok, value | error }。 */
  call: 'tab:call',
  reply: 'tab:reply',
  /** 标签 → 主进程：翻译脚本发出的消息（TranslatePageMessage 或 copy）。 */
  translate: 'tab:translate',
  /** 标签 → 主进程：用户在标签里按下了鼠标（非模态浮层听它收起，Mac 壳的 __plasticineNativePointer）。 */
  pointer: 'tab:pointer',
  /** 标签 → 主进程：「问这一页 → 操作整页」里画光点、报步骤用的消息。 */
  operate: 'tab:operate',
} as const;

/** 壳 → 界面主世界的函数名（形状见各自的 shared 文件）；只调这几个。 */
export const UI_EVENTS = ['__plasticineWebTabEvent', '__plasticineTranslateEvent', '__plasticineWindowChrome',
  '__plasticineWebMenu', '__plasticineDesktopEvent', '__plasticineNativePointer', '__plasticineFocusComposer',
  '__plasticineAttachFiles', '__plasticineNewNote'] as const;
export type UiEvent = (typeof UI_EVENTS)[number];
