// 主区里的浮层（Sheet）一次只开一个：工具组的一项、查找（2026-11-05 ≠ 分歧删了）。铃和站内信浮层第 113 条去掉了（站内信并进联系人，
// 通知记录进设置）。设置（2026-11-05 起是居中弹框，盖住整个窗口）也经这里打开：壳认到 kind 'settings' 就开设置弹框，
// 跳到那一段、那一处。

import { createContext, useContext } from 'react';
import type { SettingsSection } from './routes.ts';

export type { SettingsSection } from './routes.ts';
/** 设置弹框打开时定位到哪一处（段里带 data-settings-focus 的那一块）。 */
export type SettingsFocus = 'notes' | 'conversation' | 'tasks' | 'translate' | 'translation-model'
  | 'feed' | 'visibility' | 'notices';

export type Panel =
  | { kind: 'work'; lineId: string; taskId?: never; groupTaskId?: never }
  | { kind: 'work'; taskId: string; lineId?: never; groupTaskId?: never }
  | { kind: 'work'; groupTaskId: string; lineId?: never; taskId?: never }
  | { kind: 'backup_restore'; id: string }
  | { kind: 'tool'; name: string; moneyEntry?: { id: string; occurredAt: string };
    recordId?: string; moneyDate?: string; returnToCalendar?: boolean }
  | { kind: 'search' }
  | { kind: 'settings'; section?: SettingsSection; focus?: SettingsFocus };

export type OpenPanel = (panel: Panel | null) => void;

export const PanelContext = createContext<OpenPanel | null>(null);

export function useOpenPanel(): OpenPanel {
  const open = useContext(PanelContext);
  if (open === null) {
    throw new Error('useOpenPanel 必须在壳（Shell）里面用');
  }
  return open;
}

export function panelTitle(panel: Panel): string {
  switch (panel.kind) {
    case 'work': return '工作详情';
    case 'backup_restore': return '按对象恢复';
    case 'tool':
      return panel.name;
    case 'search':
      return '查找';
    case 'settings':
      return '设置';
  }
}
