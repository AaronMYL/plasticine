// 菜单、托盘和快捷键。Mac：应用菜单（检查更新、连接到…、重设密码…、设置 ⌘,）、编辑（没有它 ⌘C / ⌘V 不灵）、网页
// （⌘F / ⌘P / ⌘Y：键盘在网页标签里时界面收不到，由菜单交给界面，和 Swift 版一样）、窗口；⌥Space 叫出窗口并聚焦对话
// （Swift 版的默认快捷键）。Windows：没有菜单栏，托盘里有「打开」「连接到…」「重设密码…」「检查更新」「退出」——
// 关窗口只隐藏，本机本体照样跑。「连接到…」登录前也能用（回开始页二选一）；「重设密码…」只在选了这台电脑时有。

import { app, globalShortcut, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
  show(): void;
  settings(): void;
  /** 回开始页二选一。 */
  connect(): void;
  /** 打开界面的 设置 · 账号（本机凭本机令牌改密码，不问旧密码）。 */
  resetPassword(): void;
  checkUpdates(): void;
  /** 网页标签里按 ⌘F / ⌘P / ⌘Y：交给界面（web-page-tools.ts 的 WebMenuCommand）。 */
  webMenu(command: 'find' | 'print' | 'history'): void;
  focusComposer(): void;
  quit(): void;
}

export interface MenuState {
  /** 选的是这台电脑：有「重设密码…」。 */
  thisComputer: boolean;
}

const SHORTCUT = 'Alt+Space';

/** 菜单装一次；本体跑在哪变了再调 update 换「重设密码…」那一项（Electron 的菜单项不能事后改 visible 以外的东西）。 */
export function installMenu(platform: NodeJS.Platform, actions: MenuActions): (state: MenuState) => void {
  if (platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return () => undefined;
  }
  globalShortcut.register(SHORTCUT, actions.focusComposer);
  app.on('will-quit', () => globalShortcut.unregister(SHORTCUT));
  const update = (state: MenuState): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(macTemplate(actions, state)));
  };
  update({ thisComputer: false });
  return update;
}

function macTemplate(actions: MenuActions, state: MenuState): MenuItemConstructorOptions[] {
  return [
    { label: 'Plasticine', submenu: [
      { role: 'about', label: '关于 Plasticine' },
      { label: '检查更新…', click: actions.checkUpdates },
      { type: 'separator' },
      { label: '连接到…', click: actions.connect },
      { label: '重设密码…', click: actions.resetPassword, visible: state.thisComputer },
      { label: '设置…', accelerator: 'Command+,', click: actions.settings },
      { type: 'separator' },
      { role: 'hide', label: '隐藏 Plasticine' },
      { role: 'hideOthers', label: '隐藏其他' },
      { type: 'separator' },
      { label: '退出 Plasticine', accelerator: 'Command+Q', click: actions.quit },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '拷贝' }, { role: 'paste', label: '粘贴' },
      { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '网页', submenu: [
      { label: '查找…', accelerator: 'Command+F', click: () => actions.webMenu('find') },
      { label: '打印…', accelerator: 'Command+P', click: () => actions.webMenu('print') },
      { label: '历史记录', accelerator: 'Command+Y', click: () => actions.webMenu('history') },
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' },
      { role: 'togglefullscreen', label: '进入全屏' }, { type: 'separator' },
      { label: 'Plasticine', click: actions.show },
    ] },
  ];
}

/** Windows 托盘（Mac 不用：Dock 就是入口）。icon 是 PNG 路径。回一个换菜单状态的函数。 */
export function installTray(platform: NodeJS.Platform, icon: string, actions: MenuActions): (state: MenuState) => void {
  if (platform !== 'win32') {
    return () => undefined;
  }
  const tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip('Plasticine');
  tray.on('click', actions.show);
  const update = (state: MenuState): void => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Plasticine', click: actions.show },
      { label: '连接到…', click: actions.connect },
      { label: '重设密码…', click: actions.resetPassword, visible: state.thisComputer },
      { label: '检查更新', click: actions.checkUpdates },
      { type: 'separator' },
      { label: '退出（本机的 Plasticine 也会停）', click: actions.quit },
    ]));
  };
  update({ thisComputer: false });
  return update;
}
