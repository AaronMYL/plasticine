// 菜单、托盘和快捷键。Mac：应用菜单（检查更新、设置 ⌘,）、编辑（没有它 ⌘C / ⌘V 不灵）、网页（⌘F / ⌘P / ⌘Y：键盘在
// 网页标签里时界面收不到，由菜单交给界面，和 Swift 版一样）、窗口；⌥Space 叫出窗口并聚焦对话（Swift 版的默认快捷键）。
// Windows：没有菜单栏，托盘里有「打开」「检查更新」「退出」——关窗口只隐藏，本机本体照样跑。

import { app, globalShortcut, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
  show(): void;
  settings(): void;
  checkUpdates(): void;
  /** 网页标签里按 ⌘F / ⌘P / ⌘Y：交给界面（web-page-tools.ts 的 WebMenuCommand）。 */
  webMenu(command: 'find' | 'print' | 'history'): void;
  focusComposer(): void;
  quit(): void;
}

const SHORTCUT = 'Alt+Space';

export function installMenu(platform: NodeJS.Platform, actions: MenuActions): void {
  if (platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    { label: 'Plasticine', submenu: [
      { role: 'about', label: '关于 Plasticine' },
      { label: '检查更新…', click: actions.checkUpdates },
      { type: 'separator' },
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  globalShortcut.register(SHORTCUT, actions.focusComposer);
  app.on('will-quit', () => globalShortcut.unregister(SHORTCUT));
}

/** Windows 托盘（Mac 不用：Dock 就是入口）。icon 是 PNG 路径。 */
export function installTray(platform: NodeJS.Platform, icon: string, actions: MenuActions): Tray | null {
  if (platform !== 'win32') {
    return null;
  }
  const tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip('Plasticine');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Plasticine', click: actions.show },
    { label: '检查更新', click: actions.checkUpdates },
    { type: 'separator' },
    { label: '退出（本机的 Plasticine 也会停）', click: actions.quit },
  ]));
  tray.on('click', actions.show);
  return tray;
}
