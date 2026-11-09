// 桌面客户端里没有标题栏的那几页（建账号、登录、连模型）：最上面一条拖窗口的地方（base.css .window-drag-strip）。
// 网页版、手机上什么都不画。
import type { ReactNode } from 'react';
import { inDesktopApp } from './host.ts';

export function WindowDragStrip(): ReactNode {
  return inDesktopApp() ? <div className="window-drag-strip" aria-hidden="true" /> : null;
}
