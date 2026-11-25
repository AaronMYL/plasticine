import { screen, shell, type BaseWindow, type BrowserWindow, type WebContents } from 'electron';
import { isPopupRequest, isWeb, popupBounds, popupSize, type OpenRequest } from './tab-popup.ts';

export interface TabPopupsDeps {
  window: BaseWindow;
  userAgent: string;
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

  allow(request: OpenRequest): OpenHandlerResponse | null {
    if (!isPopupRequest(request)) {
      return null;
    }
    const parent = this.deps.window.getBounds();
    const bounds = popupBounds(popupSize(request.features), parent, screen.getDisplayMatching(parent).workArea);
    return { action: 'allow', overrideBrowserWindowOptions: { ...bounds, useContentSize: true, show: true,
      parent: this.deps.window, autoHideMenuBar: true, fullscreenable: false, backgroundColor: '#FFFFFF' } };
  }

  adopt(child: BrowserWindow): void {
    this.windows.add(child);
    child.once('closed', () => this.windows.delete(child));
    const contents = child.webContents;
    contents.setUserAgent(this.deps.userAgent);
    this.guard(contents);
  }

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
