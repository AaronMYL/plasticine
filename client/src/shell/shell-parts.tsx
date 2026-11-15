// 壳里用到的几个小零件：浮层里放什么、地址指着哪件工作、换页怎么算、换页的出现动画、主区开着的是哪个网页标签。

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { BackupRestoreCard } from '../views/device/backup-restore-card.tsx';
import { WorkDetail } from '../views/lines/work-detail.tsx';
import { ToolPanel } from '../views/tools/tool-panel.tsx';
import { ENTER_KEYFRAMES, MOTION, play } from './motion.ts';
import type { Panel } from './panel.ts';
import { routeHash, type Route } from './routes.ts';

export type SheetPanel = Exclude<Panel, { kind: 'settings' } | { kind: 'search' }>;

export function PanelBody({ panel, navigate }: { panel: SheetPanel; navigate: (route: Route) => void }): ReactNode {
  switch (panel.kind) {
    case 'work': return <WorkDetail {...panel} navigate={navigate} />;
    case 'backup_restore': return <BackupRestoreCard id={panel.id} />;
    case 'tool':
      return <ToolPanel name={panel.name} moneyEntry={panel.moneyEntry} recordId={panel.recordId}
        moneyDate={panel.moneyDate} returnToCalendar={panel.returnToCalendar} />;
  }
}

export function linkedWork(route: Route): Extract<Panel, { kind: 'work' }> | null {
  if (route.view !== 'work') return null;
  if (route.lineId != null) return { kind: 'work', lineId: route.lineId };
  if (route.taskId != null) return { kind: 'work', taskId: route.taskId };
  if (route.groupTaskId != null) return { kind: 'work', groupTaskId: route.groupTaskId };
  return { kind: 'work', lineId: '' };
}

/** 换页时整页重来；消息里换一个人不算换页（消息列表的位置和筛选留着）。 */
export function boundaryKey(route: Route): string {
  return route.view === 'messages' ? '#/messages' : routeHash(route);
}

/** 换页时新页面淡入、从下方 4px 升上来（180ms）。 */
export function PageEnter({ children }: { children: ReactNode }): ReactNode {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    play(element.current, ENTER_KEYFRAMES, MOTION.base);
  }, []);
  return <div ref={element} className="page-enter">{children}</div>;
}

/** 主区开着网页标签时它是哪一个（地址 #/web/<id>）；标签没了是 null。 */
export function shownWebId(route: Route): string | null {
  return route.view === 'web' ? route.webTabId ?? null : null;
}
