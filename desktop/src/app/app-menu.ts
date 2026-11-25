import { app, globalShortcut, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
  show(): void;
  settings(): void;
  connect(): void;
  resetPassword(): void;
  checkUpdates(): void;
  webMenu(command: 'find' | 'print' | 'history'): void;
  focusComposer(): void;
  quit(): void;
}

export interface MenuState {
  thisComputer: boolean;
}

const SHORTCUT = 'Alt+Space';

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

export function trayTemplate(platform: NodeJS.Platform, actions: MenuActions, state: MenuState):
  MenuItemConstructorOptions[] {
  return [
    { label: '打开 Plasticine', click: actions.show },
    ...(platform === 'darwin' ? [{ label: '设置…', click: actions.settings }] : []),
    { label: '连接到…', click: actions.connect },
    { label: '重设密码…', click: actions.resetPassword, visible: state.thisComputer },
    { label: '检查更新', click: actions.checkUpdates },
    { type: 'separator' },
    { label: '退出（本机的 Plasticine 也会停）', click: actions.quit },
  ];
}

export function installTray(platform: NodeJS.Platform, icons: { color: string; template: string },
  actions: MenuActions): (state: MenuState) => void {
  if (platform !== 'win32' && platform !== 'darwin') {
    return () => undefined;
  }
  const image = nativeImage.createFromPath(platform === 'darwin' ? icons.template : icons.color);
  if (platform === 'darwin') image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip('Plasticine');
  if (platform === 'win32') tray.on('click', actions.show);
  const update = (state: MenuState): void => {
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate(platform, actions, state)));
  };
  update({ thisComputer: false });
  return update;
}
