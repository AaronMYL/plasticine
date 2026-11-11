// 栏目（《优化清单》第 2 条，11-06 定、11-07 设计稿定的顺序；11-08 第 7 批「现在」改回「首页」；11-11 第 11 批信息流和
// 图书并成「阅读」）：最左一条图标栏放顶层入口——首页、Plasticine、消息、任务 ｜ 网页、阅读 ｜ 笔记、资料库；点一个入口，第二栏换成
// 这个栏目的列表（「首页」没有第二栏），主区只放当前打开的那一个东西。每个地址归一个栏目；点入口回到这个栏目上次停在的地方。
// 手机：底栏 首页 · Plasticine · 消息 · 笔记 · 更多；任务、阅读、资料库和设置在「更多」的抽屉里。

import type { IconName } from './icons.tsx';
import { LIBRARY_HOME } from './library-routes.ts';
import { mainLineRoute, messagesRoute, webRoute, type Route } from './routes.ts';

// 「首页」的 id 仍是 now：栏目记忆（sessionStorage）和别处的引用都按 id 存，改名不动 id。
export const SECTION_IDS = [
  'now', 'plasticine', 'messages', 'tasks', 'web', 'reading', 'notes', 'library',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface Section {
  id: SectionId;
  label: string;
  /** 'mark' 是 Plasticine 标记，别的是 icons.tsx 的图标。 */
  icon: IconName | 'mark';
  /** 点入口、第一次进来时去的地方。 */
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

/** 图标栏：组间只留空隙、不写组名。 */
export const RAIL_GROUPS: readonly (readonly SectionId[])[] = [
  ['now', 'plasticine', 'messages', 'tasks'],
  ['web', 'reading'],
  ['notes', 'library'],
];

/** 这个地址归哪个栏目。 */
export function sectionOf(route: Route): SectionId {
  switch (route.view) {
    case 'today':
    case 'settings':
      return 'now';
    case 'plasticine':
    case 'conversation':
    case 'memory':
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
      // 空间（Plasticine 写的报告）和空间列表还挂在 #/books/space… 下面，归资料库；图书馆和读书归阅读。
      return route.spaceId != null || route.spacesList === true ? 'library' : 'reading';
    case 'tools':
    case 'library':
      return 'library';
  }
}

/** 有没有第二栏：「首页」没有。 */
export function hasColumn(section: SectionId): boolean {
  return section !== 'now';
}

// ---- 手机 ----

export type PhoneTabId = 'now' | 'plasticine' | 'messages' | 'notes' | 'more';
export const PHONE_TABS: readonly PhoneTabId[] = ['now', 'plasticine', 'messages', 'notes', 'more'];

/** 「更多」抽屉里那三格：任务、阅读、资料库（11-11 信息流和图书并成阅读）。 */
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

/** 手机底栏上哪一格亮着：底栏四个栏目以外的都算「更多」。 */
export function phoneTabOf(route: Route): PhoneTabId {
  const section = sectionOf(route);
  if (section === 'now' || section === 'plasticine' || section === 'messages' || section === 'notes') {
    return section;
  }
  return 'more';
}
