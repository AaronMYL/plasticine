// 壳 → 界面：在界面视图的主世界里调约定好的几个函数（channels.ts 的 UI_EVENTS，形状见各自的 shared 文件）。
// 只在界面载入的是本站时调；参数用 JSON 写进脚本（JSON 是 JS 的子集），不拼别的字符串。

import type { WebContents } from 'electron';
import type { UiEvent } from './channels.ts';

export class UiEvents {
  private readonly ui: () => WebContents;
  private readonly onSite: () => boolean;
  private readonly log: (line: string) => void;

  constructor(ui: () => WebContents, onSite: () => boolean, log: (line: string) => void) {
    this.ui = ui;
    this.onSite = onSite;
    this.log = log;
  }

  send(name: UiEvent, ...args: unknown[]): void {
    const contents = this.ui();
    if (contents.isDestroyed() || !this.onSite()) {
      return;
    }
    const argumentList = args.map((arg) => JSON.stringify(arg)).join(', ');
    void contents.executeJavaScript(`void window.${name}?.(${argumentList});`).catch((error: unknown) => {
      this.log(`界面没收到 ${name}：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * 报窗口外观（__plasticineWindowChrome）。withControls：Windows 上在界面里按 Window Controls Overlay 量出右上角
   * 窗口按钮的实际宽度，作为 controlsRight 一起报。
   */
  windowChrome(base: { trafficLightInset: number; fullScreen: boolean }, withControls: boolean): void {
    if (!withControls) {
      this.send('__plasticineWindowChrome', base);
      return;
    }
    const contents = this.ui();
    if (contents.isDestroyed() || !this.onSite()) {
      return;
    }
    const script = `(() => { const o = navigator.windowControlsOverlay;
      const r = o && o.visible ? o.getTitlebarAreaRect() : null;
      const controlsRight = r ? Math.max(0, Math.round(window.innerWidth - (r.x + r.width))) : 0;
      void window.__plasticineWindowChrome?.({ ...${JSON.stringify(base)}, controlsRight }); })();`;
    void contents.executeJavaScript(script).catch((error: unknown) => {
      this.log(`界面没收到窗口外观：${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /** 设置页面的 hash（通知点开后去对应的地方）。 */
  navigate(hash: string): void {
    const contents = this.ui();
    if (contents.isDestroyed() || !this.onSite()) {
      return;
    }
    const target = hash.startsWith('#') ? hash.slice(1) : hash;
    void contents.executeJavaScript(`location.hash = ${JSON.stringify(target)};`).catch((error: unknown) => {
      this.log(`界面没跳过去：${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
