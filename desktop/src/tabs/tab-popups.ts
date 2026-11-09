// 网页里开的登录小窗口（11-09）：照 Chrome，window.open 带了窗口尺寸 / 是弹窗的（tab-popup.ts），开一个真的子窗口——
// 同一个网页 session、同一套 User-Agent、保留 window.opener，「用 Google 登录」这类弹窗才能把结果交回打开它的页面
// （以前一律开成新标签，没有 opener，Google 走另一条路，他在 X 上被拒）。小窗口居中在主窗口上、有标题栏可关；
// 页面自己 window.close() 就收掉。

import { screen, shell, type BaseWindow, type BrowserWindow, type WebContents } from 'electron';
import { isPopupRequest, isWeb, popupBounds, popupSize, type OpenRequest } from './tab-popup.ts';

export interface TabPopupsDeps {
  /** 主窗口：小窗口居中在它上面、跟着它（关主窗口时一起关）。 */
  window: BaseWindow;
  userAgent: string;
  /** 小窗口里点了要开新标签的链接：开在主窗口的标签里。 */
  openTab(url: string): void;
  log(line: string): void;
}

type OpenHandlerResponse = ReturnType<Parameters<WebContents['setWindowOpenHandler']>[0]>;

export class TabPopups {
  private readonly deps: TabPopupsDeps;
  private readonly windows = new Set<BrowserWindow>();

  constructor(deps: TabPopupsDeps) {
    this.deps = deps;
  }

  /** 这次 window.open 开成小窗口时给 setWindowOpenHandler 的回答；不是弹窗是 null。 */
  allow(request: OpenRequest): OpenHandlerResponse | null {
    if (!isPopupRequest(request)) {
      return null;
    }
    const parent = this.deps.window.getBounds();
    const bounds = popupBounds(popupSize(request.features), parent, screen.getDisplayMatching(parent).workArea);
    return { action: 'allow', overrideBrowserWindowOptions: { ...bounds, useContentSize: true, show: true,
      parent: this.deps.window, autoHideMenuBar: true, fullscreenable: false, backgroundColor: '#FFFFFF' } };
  }

  /** opener 那边 did-create-window 时调：认领新开的小窗口。 */
  adopt(child: BrowserWindow): void {
    this.windows.add(child);
    child.once('closed', () => this.windows.delete(child));
    const contents = child.webContents;
    contents.setUserAgent(this.deps.userAgent);
    this.guard(contents);
  }

  /** 小窗口里再开窗口、点外部链接：和网页标签一样处理。 */
  guard(contents: WebContents): void {
    contents.setWindowOpenHandler((details) => {
      const popup = this.allow(details);
      if (popup !== null) {
        return popup;
      }
      if (isWeb(details.url)) {
        this.deps.openTab(details.url);
      } else if (/^(mailto|tel):/i.test(details.url)) {
        void shell.openExternal(details.url);
      }
      return { action: 'deny' };
    });
    contents.on('did-create-window', (child) => this.adopt(child));
    contents.on('will-navigate', (event, url) => {
      if (!isWeb(url) && !url.startsWith('about:')) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    });
  }

  closeAll(): void {
    for (const window of this.windows) {
      if (!window.isDestroyed()) {
        window.close();
      }
    }
    this.windows.clear();
  }
}
