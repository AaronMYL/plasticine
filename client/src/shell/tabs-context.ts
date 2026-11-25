import { createContext, useContext } from 'react';
import type { TabOpener } from '../state/web-tabs.ts';
import type { Route } from './routes.ts';
import type { SectionId } from './sections.ts';

export interface TabActions {
  openTab: (route: Route, title?: string | null, openedBy?: TabOpener) => void;
  openWeb: (url: string, title: string, openedBy?: TabOpener) => void;
  reopenTab: (key: string) => void;
  webTabs: boolean;
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
