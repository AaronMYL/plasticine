import { createContext, useContext } from 'react';
import type { ProjectHue } from '../api/shared.ts';
import type { IconName } from './icons.tsx';
import type { Route } from './routes.ts';

export interface CurrentTab {
  id: string;
  kind: 'page' | 'web';
  title: string;
  icon?: IconName;
  route: Route | null;
  url: string | null;
  group?: CurrentGroup | null;
}

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
