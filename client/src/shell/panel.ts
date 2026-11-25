import { createContext, useContext } from 'react';
import type { SettingsSection } from './routes.ts';

export type { SettingsSection } from './routes.ts';
export type SettingsFocus = 'notes' | 'conversation' | 'tasks' | 'translate' | 'translation-model'
  | 'feed' | 'visibility' | 'notify' | 'time-zone' | 'web-search' | 'connections';

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
