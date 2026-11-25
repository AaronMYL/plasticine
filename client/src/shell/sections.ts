import type { IconName } from './icons.tsx';
import { LIBRARY_HOME } from './library-routes.ts';
import { mainLineRoute, messagesRoute, webRoute, type Route } from './routes.ts';

export const SECTION_IDS = [
  'now', 'plasticine', 'messages', 'tasks', 'web', 'reading', 'notes', 'library',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface Section {
  id: SectionId;
  label: string;
  icon: IconName | 'mark';
  root: Route;
}

export const SECTIONS: Readonly<Record<SectionId, Section>> = {
  now: { id: 'now', label: '首页', icon: 'home', root: { view: 'today', noteId: null } },
  plasticine: { id: 'plasticine', label: 'Plasticine', icon: 'mark', root: mainLineRoute() },
  messages: { id: 'messages', label: '消息', icon: 'conversation', root: messagesRoute(null) },
  tasks: { id: 'tasks', label: '任务', icon: 'tasks', root: { view: 'tasks', noteId: null, tasksSection: 'run' } },
  web: { id: 'web', label: '网页', icon: 'globe', root: webRoute(null) },
  reading: { id: 'reading', label: '阅读', icon: 'books', root: { view: 'feed', noteId: null } },
  notes: { id: 'notes', label: '笔记', icon: 'notes', root: { view: 'notes', noteId: null } },
  library: { id: 'library', label: '资料库', icon: 'archive', root: LIBRARY_HOME },
};

export const RAIL_GROUPS: readonly (readonly SectionId[])[] = [
  ['now', 'plasticine', 'messages', 'tasks'],
  ['web', 'reading'],
  ['notes', 'library'],
];

export function sectionOf(route: Route): SectionId {
  switch (route.view) {
    case 'today':
    case 'settings':
      return 'now';
    case 'plasticine':
    case 'conversation':
    case 'memory':
    case 'skills':
      return 'plasticine';
    case 'messages':
    case 'contacts':
      return 'messages';
    case 'tasks':
    case 'projects':
    case 'work':
      return 'tasks';
    case 'web':
    case 'browser':
      return 'web';
    case 'feed':
      return 'reading';
    case 'notes':
      return 'notes';
    case 'books':
      return route.spaceId != null || route.spacesList === true ? 'library' : 'reading';
    case 'tools':
    case 'library':
      return 'library';
  }
}

export function hasColumn(section: SectionId): boolean {
  return section !== 'now';
}

export type PhoneTabId = 'now' | 'plasticine' | 'messages' | 'notes' | 'more';
export const PHONE_TABS: readonly PhoneTabId[] = ['now', 'plasticine', 'messages', 'notes', 'more'];

export type MoreItemId = 'tasks' | 'reading' | 'library';
export interface MoreItem {
  id: MoreItemId;
  label: string;
  icon: IconName;
  hue: 'clay' | 'sky' | 'ochre' | 'teal';
  route: Route;
}
export const MORE_ITEMS: readonly MoreItem[] = [
  { id: 'tasks', label: '任务', icon: 'tasks', hue: 'clay', route: SECTIONS.tasks.root },
  { id: 'reading', label: '阅读', icon: 'books', hue: 'ochre', route: SECTIONS.reading.root },
  { id: 'library', label: '资料库', icon: 'archive', hue: 'teal', route: SECTIONS.library.root },
];

export function phoneTabOf(route: Route): PhoneTabId {
  const section = sectionOf(route);
  if (section === 'now' || section === 'plasticine' || section === 'messages' || section === 'notes') {
    return section;
  }
  return 'more';
}
