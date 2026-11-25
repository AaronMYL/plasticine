import type { IconName } from './icons.tsx';
import { productLink } from '../../../agent/shared/product-links.ts';
import { libraryHash, parseLibraryHash } from './library-routes.ts';
import type { SettingsFocus } from './panel.ts';

export type SkillsPane = 'add' | 'new';

export function skillsRoute(target: { name?: string | null; pane?: SkillsPane | null } = {}): Route {
  return { view: 'skills', noteId: null,
    ...(target.name == null ? {} : { skillName: target.name }),
    ...(target.pane == null ? {} : { skillsPane: target.pane }) };
}

export const VIEW_IDS = [
  'today',
  'plasticine',
  'web',
  'work',
  'messages',
  'conversation',
  'contacts',
  'projects',
  'memory',
  'skills',
  'notes',
  'books',
  'feed',
  'browser',
  'settings',
  'tools',
  'tasks',
  'library',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export interface Route {
  mateId?: string | null;
  mateGroupId?: string | null;
  plasticineMain?: boolean;
  lineId?: string | null;
  taskId?: string | null;
  groupTaskId?: string | null;
  view: ViewId;
  skillName?: string | null;
  skillsPane?: SkillsPane | null;
  noteId: string | null;
  invalidNoteId?: string;
  feedItemId?: string | null;
  messageId?: string | null;
  objectId?: string | null;
  tasksSection?: TasksSection;
  projectId?: string | null;
  objectType?: 'memory_entry';
  bookId?: string | null;
  topicId?: string | null;
  memoryDream?: boolean;
  memoryRules?: boolean;
  memoryConflicts?: boolean;
  memoryCleanup?: boolean;
  memoryLayers?: boolean;
  settingsSection?: SettingsSection;
  settingsFocus?: SettingsFocus;
  tool?: ToolName | null;
  spaceId?: string | null;
  spacePosition?: { version: number; paragraph: number };
  spacesList?: boolean;
  subscriptionId?: string | null;
  libraryTrash?: boolean;
  bookPosition?: BookRoutePosition | null;
  webTabId?: string | null;
  contactId?: string | null;
  contactPane?: ContactPane;
}

export const TASKS_SECTIONS = ['run', 'wait', 'timed', 'ideas', 'ended', 'deleted'] as const;
export type TasksSection = (typeof TASKS_SECTIONS)[number];

export type ContactPane = 'profile' | 'requests' | 'add' | 'new-group' | 'invite';
const LIST_PANES: readonly ContactPane[] = ['requests', 'add', 'new-group', 'invite'];

const LEGACY_PLASTICINE_THREAD = 'plasticine';

export const SPACE_SEGMENT = 'space';

export interface BookRoutePosition {
  chapter: number;
  offset: number;
}

export const SETTINGS_SECTIONS = ['general', 'account', 'ai', 'grants', 'browser', 'system'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const LEGACY_SETTINGS: Readonly<Record<string, { section: SettingsSection; focus?: SettingsFocus }>> = {
  daily: { section: 'general', focus: 'time-zone' },
  feed: { section: 'browser', focus: 'feed' },
  network: { section: 'account' },
  privacy: { section: 'grants' },
  visibility: { section: 'grants', focus: 'visibility' },
  notices: { section: 'general', focus: 'notify' },
};

function settingsLink(segment: string | undefined): Route {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate === segment);
  if (section !== undefined) {
    return { view: 'settings', noteId: null, settingsSection: section };
  }
  const legacy = segment === undefined ? undefined : LEGACY_SETTINGS[segment];
  if (legacy === undefined) {
    return { view: 'settings', noteId: null };
  }
  return legacy.focus === undefined ? { view: 'settings', noteId: null, settingsSection: legacy.section }
    : { view: 'settings', noteId: null, settingsSection: legacy.section, settingsFocus: legacy.focus };
}

const PHONE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(['today', 'plasticine', 'messages', 'conversation',
  'contacts', 'notes', 'feed', 'settings', 'work', 'tasks', 'books', 'library']);

export function phonePageAvailable(route: Route): boolean {
  if (PHONE_VIEWS.has(route.view)) return true;
  if (route.view === 'tools') return route.tool === '文件';
  if (route.view === 'projects') return route.projectId != null;
  if (route.view === 'memory' || route.view === 'skills') return true;
  return false;
}

export function phoneRoute(route: Route): Route {
  return route;
}

export const TOOL_ITEMS = ['记账', '浏览器', '文件'] as const;

export type ToolName = (typeof TOOL_ITEMS)[number];

export const TOOL_ICONS: Record<ToolName, IconName> = {
  记账: 'wallet', 浏览器: 'globe', 文件: 'folder',
};

export const TOOL_SLUGS: Record<Exclude<ToolName, '浏览器'>, string> = {
  记账: 'money', 文件: 'files',
};

function toolFromSlug(slug: string | undefined): ToolName | null {
  const found = Object.entries(TOOL_SLUGS).find(([, value]) => value === slug);
  return found === undefined ? null : found[0] as ToolName;
}

export function toolRoute(tool: ToolName): Route {
  return tool === '浏览器' ? { view: 'browser', noteId: null } : { view: 'tools', noteId: null, tool };
}

export const HOME: Route = { view: 'today', noteId: null };

export function isViewId(value: string): value is ViewId {
  return (VIEW_IDS as readonly string[]).includes(value);
}

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((part) => part !== '');
  const [view, id, sub, third] = parts;
  if (view === 'inbox') {
    return messagesRoute(null);
  }
  if (view === 'bookmarks' || view === 'newtab') {
    return webRoute(null);
  }
  if (view === 'web') {
    return webRoute(id === undefined ? null : decodedOrNull(id));
  }
  if (view === 'plasticine') {
    return plasticineRoute(id, sub);
  }
  const retired = retiredRoute(view, id);
  if (retired !== null) {
    return retired;
  }
  if (view === undefined || !isViewId(view)) {
    return HOME;
  }
  if (view === 'messages' || view === 'contacts') {
    return contactsRoute(id, sub, third);
  }
  if (view === 'conversation') {
    return id === undefined || id === 'matters' ? mainChatRoute() : plasticineRoute(id, undefined);
  }
  if (view === 'notes' && id !== undefined) {
    return notesRoute(id);
  }
  if (view === 'work') return workRoute(id, sub);
  if (view === 'library') return parseLibraryHash(id, sub);
  if (view === 'tasks') return tasksRoute(id);
  if (view === 'settings') {
    return settingsLink(id);
  }
  if (view === 'tools') {
    return { view, noteId: null, tool: toolFromSlug(id) };
  }
  if (view === 'books' && id === SPACE_SEGMENT && sub === undefined) {
    return { view, noteId: null, bookId: null, spaceId: null, spacesList: true };
  }
  if (view === 'books' && id === SPACE_SEGMENT && sub !== undefined) {
    const version = Number(parts[3]);
    const paragraph = Number(parts[4]);
    const position = Number.isSafeInteger(version) && version > 0 && Number.isSafeInteger(paragraph) && paragraph > 0
      ? { spacePosition: { version, paragraph } } : {};
    return { view, noteId: null, bookId: null, spaceId: decodedOrNull(sub), ...position };
  }
  if (view === 'books' && id !== undefined) { return booksRoute(id, sub, parts[3]); }
  if (view === 'feed' && id !== undefined) { return { view, noteId: null, feedItemId: decodedOrNull(id) }; }
  if (view === 'skills') {
    if (id === 'add' || id === 'new') return skillsRoute({ pane: id });
    return skillsRoute({ name: id === 's' && sub !== undefined ? decodedOrNull(sub) : null });
  }
  if (view === 'memory' && id === 'topics' && sub !== undefined) {
    return { view, noteId: null, topicId: decodedOrNull(sub) };
  }
  if (view === 'memory' && id === 'dream') {
    return { view, noteId: null, memoryDream: true };
  }
  if (view === 'memory' && id === 'rules') return soulRoute(sub === undefined ? null : decodedOrNull(sub));
  if (view === 'memory' && id === 'conflicts') return conflictsRoute();
  if (view === 'memory' && id === 'cleanup') return cleanupRoute();
  if (view === 'memory' && id === 'layers') return layersMoveRoute();
  if (view === 'projects') {
    return { view, noteId: null, projectId: id === undefined ? null : decodedOrNull(id) };
  }
  if (view === 'memory' && id !== undefined) {
    if (id === 'judgments' || id === 'sources') {
      return { view, noteId: null };
    }
    if (id === 'agreements' || id === 'terms') {
      return { view, noteId: null, memoryRules: true };
    }
    if (id === 'entries') {
      const objectId = sub === undefined ? null : decodedOrNull(sub);
      return { view, noteId: null, objectType: 'memory_entry', objectId };
    }
  }
  return { view, noteId: null };
}

export function tasksRoute(segment: string | undefined): Route {
  const section = TASKS_SECTIONS.find((candidate) => candidate === segment) ?? 'run';
  return { view: 'tasks', noteId: null, tasksSection: section };
}

function workRoute(id: string | undefined, sub: string | undefined): Route {
  if (id === 'task') return { view: 'work', noteId: null, taskId: sub === undefined ? null : decodedOrNull(sub) };
  if (id === 'group-task') {
    return { view: 'work', noteId: null, groupTaskId: sub === undefined ? null : decodedOrNull(sub) };
  }
  return { view: 'work', noteId: null, lineId: id === undefined ? null : decodedOrNull(id) };
}

export function contactMessageRoute(contactId: string, messageId: string): Route {
  return { view: 'messages', noteId: null, contactId, messageId };
}

const LINE_REF = /^line:(.+):(\d+)$/;

export function parseLineRef(ref: string | null | undefined): { lineId: string; seq: number } | null {
  const match = ref == null ? null : LINE_REF.exec(ref);
  return match?.[1] === undefined || match[2] === undefined ? null : { lineId: match[1], seq: Number(match[2]) };
}

export function messagesRoute(contactId: string | null, pane?: ContactPane): Route {
  return pane === undefined ? { view: 'messages', noteId: null, contactId }
    : { view: 'messages', noteId: null, contactId, contactPane: pane };
}

const SIDE_SEGMENT = 'side';

export function mainLineRoute(messageId: string | null = null): Route {
  return messageId === null ? { view: 'plasticine', noteId: null }
    : { view: 'plasticine', noteId: null, messageId };
}

export function mainChatRoute(): Route { return { view: 'plasticine', noteId: null, plasticineMain: true }; }
export function mateRoute(mateId: string): Route { return { view: 'plasticine', noteId: null, mateId }; }
export function mateGroupRoute(mateGroupId: string): Route {
  return { view: 'plasticine', noteId: null, mateGroupId };
}
export function soulRoute(mateId: string | null = null): Route {
  return { view: 'memory', noteId: null, memoryRules: true, mateId };
}

export function cleanupRoute(): Route {
  return { view: 'memory', noteId: null, memoryCleanup: true };
}

export function layersMoveRoute(): Route {
  return { view: 'memory', noteId: null, memoryLayers: true };
}

export function conflictsRoute(): Route {
  return { view: 'memory', noteId: null, memoryConflicts: true };
}

export function sideRoute(lineId: string): Route {
  return { view: 'plasticine', noteId: null, lineId };
}

export function webRoute(webTabId: string | null): Route {
  return { view: 'web', noteId: null, webTabId };
}

function plasticineRoute(id: string | undefined, sub: string | undefined): Route {
  const target = sub === undefined ? null : decodedOrNull(sub);
  if (id === 'main') return mainChatRoute();
  if (id === 'soul') return soulRoute(target);
  if (id === 'mate' && target !== null) return mateRoute(target);
  if (id === 'group' && target !== null) return mateGroupRoute(target);
  if (id === SIDE_SEGMENT) {
    const sideId = sub === undefined ? null : decodedOrNull(sub);
    return sideId === null ? mainLineRoute() : sideRoute(sideId);
  }
  return mainLineRoute(id === undefined ? null : decodedOrNull(id));
}

function contactsRoute(id: string | undefined, sub: string | undefined, third?: string): Route {
  const pane = LIST_PANES.find((candidate) => candidate === id);
  if (pane !== undefined) {
    return messagesRoute(null, pane);
  }
  const contactId = id === undefined ? null : decodedOrNull(id);
  if (contactId === LEGACY_PLASTICINE_THREAD) {
    return sub === SIDE_SEGMENT ? plasticineRoute(SIDE_SEGMENT, third)
      : sub === undefined ? mainChatRoute() : plasticineRoute(sub, undefined);
  }
  if (contactId !== null && sub === 'profile') {
    return messagesRoute(contactId, 'profile');
  }
  const messageId = sub === 'at' && third !== undefined ? decodedOrNull(third) : null;
  if (contactId !== null && messageId !== null) {
    return contactMessageRoute(contactId, messageId);
  }
  return messagesRoute(contactId);
}

function decodedOrNull(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

function booksRoute(id: string, chapter: string | undefined, offset: string | undefined): Route {
  const bookId = decodedOrNull(id);
  const numbers = [chapter, offset].map((part) => (part !== undefined && /^\d+$/.test(part) ? Number(part) : null));
  const [chapterIndex, offsetIndex] = numbers;
  const bookPosition = chapterIndex == null || offsetIndex == null ? null
    : { chapter: chapterIndex, offset: offsetIndex };
  return { view: 'books', noteId: null, bookId, bookPosition };
}

function notesRoute(segment: string): Route {
  try {
    return { view: 'notes', noteId: decodeURIComponent(segment) };
  } catch (error) {
    if (error instanceof URIError) {
      return { view: 'notes', noteId: null, invalidNoteId: segment };
    }
    throw error;
  }
}

function retiredRoute(view: string | undefined, id: string | undefined): Route | null {
  switch (view) {
    case 'concerns':
      return { view: 'projects', noteId: null, projectId: null };
    case 'artifacts':
      return { view: 'notes', noteId: null };
    case 'device':
      return { view: 'settings', noteId: null, settingsSection: 'system' };
    case 'tools':
      return id === 'focus' || id === 'calendar' || id === 'reminders' ? HOME : null;
    default:
      return null;
  }
}

export function routeHash(route: Route): string {
  if (route.view === 'plasticine') {
    if (route.mateId != null) return `#/plasticine/mate/${encodeURIComponent(route.mateId)}`;
    if (route.mateGroupId != null) return `#/plasticine/group/${encodeURIComponent(route.mateGroupId)}`;
    if (route.plasticineMain === true) return '#/plasticine/main';
    if (route.lineId != null) return `#/plasticine/${SIDE_SEGMENT}/${encodeURIComponent(route.lineId)}`;
    return route.messageId == null ? '#/plasticine' : `#/plasticine/${encodeURIComponent(route.messageId)}`;
  }
  if (route.view === 'web') {
    return route.webTabId == null ? '#/web' : productLink('web', route.webTabId);
  }
  if (route.view === 'library') {
    return libraryHash(route);
  }
  if (route.view === 'tasks') {
    const section = route.tasksSection ?? 'run';
    return section === 'run' ? '#/tasks' : `#/tasks/${section}`;
  }
  if (route.view === 'work') {
    if (route.taskId != null) return `#/work/task/${encodeURIComponent(route.taskId)}`;
    if (route.groupTaskId != null) return `#/work/group-task/${encodeURIComponent(route.groupTaskId)}`;
    return route.lineId == null ? '#/work' : `#/work/${encodeURIComponent(route.lineId)}`;
  }
  if (route.view === 'settings' && route.settingsSection !== undefined && route.settingsSection !== 'general') {
    return `#/settings/${route.settingsSection}`;
  }
  if (route.view === 'tools' && route.tool != null && route.tool !== '浏览器') {
    return `#/tools/${TOOL_SLUGS[route.tool]}`;
  }
  if (route.view === 'messages' || route.view === 'contacts') {
    return contactsHash(route);
  }
  if (route.view === 'conversation') {
    return routeHash(route.messageId == null ? mainChatRoute() : mainLineRoute(route.messageId));
  }
  if (route.view === 'feed' && route.feedItemId != null) {
    return `#/feed/${encodeURIComponent(route.feedItemId)}`;
  }
  if (route.view === 'skills') {
    if (route.skillsPane != null) return `#/skills/${route.skillsPane}`;
    return route.skillName == null ? '#/skills' : `#/skills/s/${encodeURIComponent(route.skillName)}`;
  }
  if (route.view === 'memory' && route.topicId != null) {
    return `#/memory/topics/${encodeURIComponent(route.topicId)}`;
  }
  if (route.view === 'memory' && route.memoryDream === true) {
    return '#/memory/dream';
  }
  if (route.view === 'memory' && route.memoryRules === true) {
    return `#/memory/rules${route.mateId == null ? '' : '/' + encodeURIComponent(route.mateId)}`;
  }
  if (route.view === 'memory' && route.memoryConflicts === true) return '#/memory/conflicts';
  if (route.view === 'memory' && route.memoryCleanup === true) return '#/memory/cleanup';
  if (route.view === 'memory' && route.memoryLayers === true) return '#/memory/layers';
  if (route.view === 'projects' && route.projectId != null) {
    return productLink('project', route.projectId);
  }
  if (route.view === 'books' && route.spacesList === true) {
    return `#/books/${SPACE_SEGMENT}`;
  }
  if (route.view === 'books' && route.spaceId != null) {
    const position = route.spacePosition;
    const suffix = position === undefined ? '' : `/${position.version}/${position.paragraph}`;
    return `${productLink('space', route.spaceId)}${suffix}`;
  }
  if (route.view === 'books' && route.bookId != null) {
    const position = route.bookPosition == null ? '' : `/${route.bookPosition.chapter}/${route.bookPosition.offset}`;
    return `${productLink('book', route.bookId)}${position}`;
  }
  if (route.objectId != null && route.objectType !== undefined) {
    return `#/memory/entries/${encodeURIComponent(route.objectId)}`;
  }
  if (route.view === 'notes' && route.noteId !== null) {
    return productLink('note', route.noteId);
  }
  return `#/${route.view}`;
}

function contactsHash(route: Route): string {
  if (route.contactPane !== undefined && LIST_PANES.includes(route.contactPane)) {
    return `#/messages/${route.contactPane}`;
  }
  if (route.contactId == null) {
    return '#/messages';
  }
  const base = productLink('contact', route.contactId);
  if (route.messageId != null) return `${base}/at/${encodeURIComponent(route.messageId)}`;
  return route.contactPane === 'profile' ? `${base}/profile` : base;
}

const VIEW_LABELS: Readonly<Record<ViewId, string>> = {
  today: '首页', plasticine: 'Plasticine', web: '网页', work: '工作', messages: '消息', conversation: '消息',
  contacts: '消息', projects: '项目', memory: '记忆', skills: '技能', notes: '笔记', books: '图书', feed: '信息流',
  browser: '浏览器', settings: '设置', tools: '工具', tasks: '任务', library: '资料库',
};

export function navLabel(view: ViewId): string {
  return VIEW_LABELS[view];
}
