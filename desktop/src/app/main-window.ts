// 主窗口：一个 BaseWindow，里面是界面（Plasticine 本站网页）的 WebContentsView，网页标签的视图按 tab-layering.ts
// 叠在它上面或垫在它下面（所以界面视图底色透明）。Mac 隐藏标题栏、红绿灯落在界面自己画的标题栏里（44 高，竖直居中，
// 位置和让出的宽度见 traffic-lights.ts）；Windows 隐藏标题栏，右上角是系统的窗口按钮（titleBarOverlay，Window Controls
// Overlay），和界面标题栏一样高。拖窗口靠界面标题栏上的 -webkit-app-region。
// Mac 上关窗口只隐藏；Windows 上关窗口也只隐藏（托盘里还在，本机本体照样跑），退出在托盘菜单里。

import { BaseWindow, nativeTheme, WebContentsView, type BaseWindowConstructorOptions } from 'electron';
import { TITLEBAR_HEIGHT } from '../../../agent/shared/api/mac-bridge.ts';
import { macTrafficLights } from './traffic-lights.ts';

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;
/** 方向 I 的底色（tokens.css 的 --bg，浅色 / 深色），窗口还没画出界面时用它，不闪白。 */
const BACKGROUND = { light: '#FAF8F4', dark: '#1C1B19' };
const SYMBOL = { light: '#2A2622', dark: '#F5F1EC' };

export function windowOptions(platform: NodeJS.Platform, dark: boolean, systemVersion: string)
  : BaseWindowConstructorOptions {
  const common: BaseWindowConstructorOptions = { width: 1440, height: 900, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT,
    show: false, title: 'Plasticine', backgroundColor: dark ? BACKGROUND.dark : BACKGROUND.light };
  if (platform === 'darwin') {
    return { ...common, titleBarStyle: 'hidden', trafficLightPosition: macTrafficLights(systemVersion).position };
  }
  if (platform === 'win32') {
    return { ...common, titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000',
      symbolColor: dark ? SYMBOL.dark : SYMBOL.light, height: TITLEBAR_HEIGHT } };
  }
  return common;
}

export interface WindowChromeState {
  trafficLightInset: number;
  fullScreen: boolean;
}

export class MainWindow {
  readonly window: BaseWindow;
  readonly ui: WebContentsView;
  private readonly platform: NodeJS.Platform;
  private quitting = false;
  /** Mac 红绿灯让出的宽度（按系统版本，traffic-lights.ts）。 */
  private readonly lightsInset: number;

  constructor(platform: NodeJS.Platform, preload: string, onResize: () => void) {
    this.platform = platform;
    this.lightsInset = macTrafficLights(process.getSystemVersion()).inset;
    this.window = new BaseWindow(windowOptions(platform, nativeTheme.shouldUseDarkColors, process.getSystemVersion()));
    this.ui = new WebContentsView({ webPreferences: { preload, contextIsolation: true, sandbox: true,
      nodeIntegration: false, spellcheck: true } });
    this.ui.setBackgroundColor('#00000000');
    this.window.contentView.addChildView(this.ui);
    const fit = (): void => {
      const [width, height] = this.window.getContentSize();
      this.ui.setBounds({ x: 0, y: 0, width: width ?? 0, height: height ?? 0 });
      onResize();
    };
    fit();
    this.window.on('resize', fit);
    this.window.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault();
        this.window.hide();
      }
    });
    nativeTheme.on('updated', () => {
      if (platform === 'win32') {
        this.window.setTitleBarOverlay({ color: '#00000000',
          symbolColor: nativeTheme.shouldUseDarkColors ? SYMBOL.dark : SYMBOL.light });
      }
    });
  }

  chrome(): WindowChromeState {
    const fullScreen = this.window.isFullScreen();
    const inset = this.platform === 'darwin' && !fullScreen ? this.lightsInset : 0;
    return { trafficLightInset: inset, fullScreen };
  }

  show(): void {
    if (this.window.isMinimized()) {
      this.window.restore();
    }
    this.window.show();
    this.window.focus();
    this.ui.webContents.focus();
  }

  /** 退出时真关窗口（平时关窗口只隐藏）。 */
  allowClose(): void {
    this.quitting = true;
  }
}
