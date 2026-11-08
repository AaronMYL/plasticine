// 对话框跟着当前标签（2026-11-04 第 2 批，用户定）：顶栏写当前标签（图标 + 标题），「问这一页」开着时发出去的话带上
// 这一页；都读这里。壳按当前标签算好图标、标题和地址放进来；切标签时对话不换线，只换这份「当前标签」。

import { createContext, useContext } from 'react';
import type { ProjectHue } from '../api/shared.ts';
import type { IconName } from './icons.tsx';
import type { Route } from './routes.ts';

export interface CurrentTab {
  id: string;
  kind: 'page' | 'web';
  title: string;
  /** 顶栏标签上的那个图标（tab-look.ts）；没给时按种类（网页地球、页面文件）。 */
  icon?: IconName;
  /** 页面标签的路由；网页标签是 null。 */
  route: Route | null;
  /** 网页标签的网址；页面标签是 null。 */
  url: string | null;
  /** 当前标签所在的组（第 111 条「问这一组」）；不在组里是 null。 */
  group?: CurrentGroup | null;
}

/** 一组：名字、颜色和组里的每一页（按顶栏上的先后）。 */
export interface CurrentGroup {
  id: string;
  name: string;
  hue: ProjectHue;
  tabs: Omit<CurrentTab, 'group'>[];
}

export const CurrentTabContext = createContext<CurrentTab | null>(null);

export function useCurrentTab(): CurrentTab | null {
  return useContext(CurrentTabContext);
}
