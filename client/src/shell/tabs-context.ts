// 视图里「打开」的入口（首页卡、Plasticine 替你开的、⌘K 的结果）：壳提供实现（shell.tsx）。
// 11-07 两层侧栏起只有网页是标签：openTab 是走到那一页（多一步历史，前进后退能回来）；openWeb 在桌面客户端里开成竖排
// 标签，网页版在新窗口打开（也记进竖排标签的「今天」）。

import { createContext, useContext } from 'react';
import type { TabOpener } from '../state/web-tabs.ts';
import type { Route } from './routes.ts';
import type { SectionId } from './sections.ts';

export interface TabActions {
  /** 走到一页（Plasticine 自己的页面）。标题不再用，留着参数兼容旧调用。 */
  openTab: (route: Route, title?: string | null, openedBy?: TabOpener) => void;
  /** 打开网页：桌面客户端里是一个竖排标签；别处在新窗口打开。 */
  openWeb: (url: string, title: string, openedBy?: TabOpener) => void;
  /** 从「关掉的」重开一个网页。 */
  reopenTab: (key: string) => void;
  /** 这台是不是桌面客户端（网页标签能不能真开）。 */
  webTabs: boolean;
  /** 切到一个栏目（回到它上次停在的地方）。 */
  focusSection: (section: SectionId) => void;
}

export const TabsContext = createContext<TabActions | null>(null);

export function useTabActions(): TabActions {
  const actions = useContext(TabsContext);
  if (actions === null) {
    throw new Error('useTabActions 必须在壳（Shell）里面用');
  }
  return actions;
}
