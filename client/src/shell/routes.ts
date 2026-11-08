// 路由：用地址里的 # 段（#/notes/note_0001），不需要服务端配合，刷新也回到同一页。
// 2026-11-07《优化清单》第 2 条（两层侧栏）：Plasticine 自己的页面都是导航，前进后退走地址；只有网页是标签（#/web/<id>）。
// 栏目归属在 sections.ts。和 Plasticine 的主线、旁聊是自己的栏目（#/plasticine…），消息里只剩人、群、邮件；
// 旧地址 #/conversation…、#/messages/plasticine…、#/contacts…、#/inbox…、#/bookmarks、#/newtab 都落到新的地方。
// 2026-11-05 删掉的页（任务 / 看板 / 任务详情、关切、判断、采访、成果、专注、自建日历和提醒、改进发现）：旧链接落到
// 最合适的新页面——任务回首页（「在做」在那里），关切去项目，成果去笔记（成果迁进「Plasticine 写的」），判断去记忆。

import type { IconName } from './icons.tsx';
import type { SettingsFocus } from './panel.ts';

// 成果卡片和侧栏「工具 · 成果」都在主区打开成果页（第 92 条）。
export const VIEW_IDS = [
  'today',
  // 2026-11-07 两层侧栏：和 Plasticine 的主线、旁聊（#/plasticine、#/plasticine/side/<线>）。
  'plasticine',
  // 网页栏目（#/web 没选标签、#/web/<标签 id> 一个网页标签）。
  'web',
  // 工作详情通过壳打开同一个 Sheet，不增加主导航。
  'work',
  // 2026-11-04：消息 = 和 Plasticine 的全部记录 + 联系人（人、邮件、AI 建议），一个入口。
  'messages',
  // 旧的两个入口：地址解析时都换成消息（parseHash 不再给出它们）；别处还拿它们拼路由，routeHash 照样写成消息的地址。
  'conversation',
  'contacts',
  'projects',
  'memory',
  'notes',
  'books',
  'feed',
  'browser',
  // 设置（弹框，地址只用来开它）、工具整页（对话里的工具卡「看全貌」）。
  'settings',
  'tools',
  // 2026-11-07《优化清单》第 3 条：任务栏目（在做 / 等你 / 定时 / 建议，#/tasks/<段>）。侧栏入口第三段做，地址先能打开。
  'tasks',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export interface Route {
  lineId?: string | null;
  taskId?: string | null;
  groupTaskId?: string | null;
  view: ViewId;
  /** 笔记页打开的是哪一篇；别的页为 null。 */
  noteId: string | null;
  /**
   * 地址里笔记那一段解不开（不完整的百分号编码，如 #/notes/%）：原样留在这里，noteId 为 null，
   * 页面上说明打不开，而不是让 decodeURIComponent 抛错、整个壳渲染不出来。
   */
  invalidNoteId?: string;
  termId?: string | null;
  feedItemId?: string | null;
  messageId?: string | null;
  objectId?: string | null;
  /** 任务栏目开在哪一段（#/tasks/run|wait|timed|ideas）。 */
  tasksSection?: TasksSection;
  /** 项目页打开的是哪一个（#/projects/<id>）；列表时为 null。 */
  projectId?: string | null;
  /** 记忆页单独读一条的对象（引用里的原话、约定、来源）。 */
  objectType?: 'memory_entry' | 'agreement';
  /** 图书页打开的是哪一本（#/books/<id>）；图书馆时为 null。 */
  bookId?: string | null;
  /** 记忆页打开的是哪一份主题文档（#/memory/topics/<id>）；目录时不带。 */
  topicId?: string | null;
  /** 「昨晚整理了什么」（#/memory/dream，第 10、16 条）。 */
  memoryDream?: boolean;
  /**
   * 设置弹框开在哪一段（#/settings/<段>，2026-11-05 起设置不占标签：这种地址只用来开弹框，壳认到就开、地址换回当前标签的）。
   * 旧段名（feed、network…）和旧地址 #/device 都映射到新的六段，见 settingsLink。
   */
  settingsSection?: SettingsSection;
  /** 跟着旧段名来的定位（#/settings/feed 到「浏览器与信息流」里的信息流来源）。 */
  settingsFocus?: SettingsFocus;
  /** 工具页是哪一个（#/tools/<名>）。 */
  tool?: ToolName | null;
  /**
   * 资料库里打开的空间（#/books/space/<id>，《优化清单》第 6 条）：Plasticine 写的报告、周报、整理稿。两层侧栏做好之前
   * 先挂在图书（以后的资料库）下面。
   */
  spaceId?: string | null;
  /** 空间的列表（#/books/space，手机「更多 · 空间」；电脑上空间列在资料库的第二栏）。 */
  spacesList?: boolean;
  /** 打开时跳到书里的哪一处（#/books/<id>/<章>/<字>）：对话里的书引用片「回到原文」、讨论、搜索从外面跳进来用。 */
  bookPosition?: BookRoutePosition | null;
  /** 网页栏目打开的是哪个标签（#/web/<id>）；没选是 null。 */
  webTabId?: string | null;
  /**
   * 消息里打开的是哪一条（#/messages/<id>）：联系人的 id；只是列表时为 null（电脑上右边是列表里第一条，手机上是列表）。
   */
  contactId?: string | null;
  /** 手机上的资料整页（#/messages/<id>/profile）、新请求（#/messages/requests）。 */
  contactPane?: ContactPane;
}

/** 任务栏目的四段（《优化清单》第 3 条）：在做、等你、定时、建议。项目那一块是项目页。 */
export const TASKS_SECTIONS = ['run', 'wait', 'timed', 'ideas'] as const;
export type TasksSection = (typeof TASKS_SECTIONS)[number];

/** 2026-11-05 网络：加好友、新建群聊、邀请朋友加入网络也是右边整块（手机上一整页），各有地址。 */
export type ContactPane = 'profile' | 'requests' | 'add' | 'new-group' | 'invite';
/** 列表上那几块（不挂在某个联系人上）。 */
const LIST_PANES: readonly ContactPane[] = ['requests', 'add', 'new-group', 'invite'];

/** 旧地址 #/messages/plasticine…（11-04 消息里固定第一条的 Plasticine）：解析时换成 #/plasticine…。 */
const LEGACY_PLASTICINE_THREAD = 'plasticine';

/** 空间地址里的那一段（#/books/space/<id>）；书的编号由服务端生成，不会是这个词。 */
export const SPACE_SEGMENT = 'space';

export interface BookRoutePosition {
  /** 第几章，从 0 起。 */
  chapter: number;
  /** 章内第几个字（UTF-16 下标，和章节正文的 textContent 一致）。 */
  offset: number;
}

export interface NavItem {
  id: ViewId;
  label: string;
  icon: IconName;
}

/**
 * 设置弹框的六段（2026-11-05 他定）：通用（原「常用」+ 外观）· AI（含笔记、翻译模型）· 日常 · 浏览器与信息流 ·
 * 账号（原「账号与网络」+「对外可见」+「通知记录」）· 系统（原系统页）。
 */
export const SETTINGS_SECTIONS = ['general', 'ai', 'daily', 'browser', 'account', 'system'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** 旧地址的段名（第 113 条和第 3 批那九段）落到新六段的哪一段、哪一处。 */
const LEGACY_SETTINGS: Readonly<Record<string, { section: SettingsSection; focus?: SettingsFocus }>> = {
  feed: { section: 'browser', focus: 'feed' },
  network: { section: 'account' },
  visibility: { section: 'account', focus: 'visibility' },
  notices: { section: 'account', focus: 'notices' },
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

/**
 * 手机上能开的页（11-07 定：底栏 现在 · Plasticine · 消息 · 笔记 · 更多，任务、信息流、图书、空间在「更多」里）；
 * 项目和记忆从搜索、引用承接只读详情；网页标签只在电脑上；不支持的对象保留地址并说明。
 */
const PHONE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(['today', 'plasticine', 'messages', 'conversation',
  'contacts', 'notes', 'feed', 'settings', 'work', 'tasks', 'books']);

export function phonePageAvailable(route: Route): boolean {
  if (route.view === 'books') return route.bookId == null || route.spaceId != null;
  if (PHONE_VIEWS.has(route.view)) return true;
  if (route.view === 'projects') return route.projectId != null;
  if (route.view === 'memory') {
    return route.topicId != null || route.memoryDream === true || route.termId !== undefined
      || route.objectType !== undefined;
  }
  return false;
}

/** 保住深链接；不支持的页由 CurrentView 显示继续在电脑打开的说明，不改写成首页。 */
export function phoneRoute(route: Route): Route {
  return route;
}

/**
 * 工具（新标签页「工具」一排）：浏览器在主区打开，其余开成整页。2026-11-05：专注、自建的日历和提醒删了（Apple 日历和
 * 提醒以后由 Mac 接）。
 */
export const TOOL_ITEMS = ['记账', '浏览器', '文件'] as const;

export type ToolName = (typeof TOOL_ITEMS)[number];

export const TOOL_ICONS: Record<ToolName, IconName> = {
  记账: 'wallet', 浏览器: 'globe', 文件: 'folder',
};

/** 工具整页的地址段（#/tools/money）；浏览器仍是自己的 #/browser。 */
export const TOOL_SLUGS: Record<Exclude<ToolName, '浏览器'>, string> = {
  记账: 'money', 文件: 'files',
};

function toolFromSlug(slug: string | undefined): ToolName | null {
  const found = Object.entries(TOOL_SLUGS).find(([, value]) => value === slug);
  return found === undefined ? null : found[0] as ToolName;
}

/** 打开一个工具的路由：浏览器是自己的页，别的是工具整页。 */
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
  // 第 106、111 条：站内信页去掉了，旧链接都到联系人；2026-11-04 联系人并进消息。
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
    // 「事」不在界面出现（2026-11-04）：事的线的旧链接也回到主线。
    return plasticineRoute(id === 'matters' ? undefined : id, undefined);
  }
  if (view === 'notes' && id !== undefined) {
    return notesRoute(id);
  }
  if (view === 'work') return workRoute(id, sub);
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
    return { view, noteId: null, bookId: null, spaceId: decodedOrNull(sub) };
  }
  if (view === 'books' && id !== undefined) { return booksRoute(id, sub, parts[3]); }
  if (view === 'feed' && id !== undefined) { return { view, noteId: null, feedItemId: decodedOrNull(id) }; }
  if (view === 'memory' && id === 'topics' && sub !== undefined) {
    return { view, noteId: null, topicId: decodedOrNull(sub) };
  }
  if (view === 'memory' && id === 'dream') {
    return { view, noteId: null, memoryDream: true };
  }
  if (view === 'projects') {
    return { view, noteId: null, projectId: id === undefined ? null : decodedOrNull(id) };
  }
  if (view === 'memory' && id !== undefined) {
    const types = { entries: 'memory_entry', agreements: 'agreement' } as const;
    // 判断、来源证据删了：#/memory/judgments…、#/memory/sources… 就是记忆页本身。
    if (id === 'judgments' || id === 'sources') {
      return { view, noteId: null };
    }
    if (id in types) {
      return { view, noteId: null, objectType: types[id as keyof typeof types],
        objectId: sub === undefined ? null : decodedOrNull(sub) };
    }
  }
  if (view === 'memory' && id === 'terms') {
    return { view, noteId: null, termId: sub === undefined ? null : decodedOrNull(sub) };
  }
  return { view, noteId: null };
}

/** #/tasks[/<段>]：认不得的段（旧任务详情的地址）落到「在做」。 */
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

/** 消息里的一条：联系人的 id，或 null（只是列表）。 */
export function messagesRoute(contactId: string | null, pane?: ContactPane): Route {
  return pane === undefined ? { view: 'messages', noteId: null, contactId }
    : { view: 'messages', noteId: null, contactId, contactPane: pane };
}

const SIDE_SEGMENT = 'side';

/** 主线（#/plasticine），可带要跳到的那一句（#/plasticine/<消息引用>）。 */
export function mainLineRoute(messageId: string | null = null): Route {
  return messageId === null ? { view: 'plasticine', noteId: null }
    : { view: 'plasticine', noteId: null, messageId };
}

/** 一条旁聊（#/plasticine/side/<线 id>）。 */
export function sideRoute(lineId: string): Route {
  return { view: 'plasticine', noteId: null, lineId };
}

/** 网页栏目：一个网页标签，或 null（没选标签）。 */
export function webRoute(webTabId: string | null): Route {
  return { view: 'web', noteId: null, webTabId };
}

/** #/plasticine[/<消息引用>]、#/plasticine/side/<线>。 */
function plasticineRoute(id: string | undefined, sub: string | undefined): Route {
  if (id === SIDE_SEGMENT) {
    const sideId = sub === undefined ? null : decodedOrNull(sub);
    return sideId === null ? mainLineRoute() : sideRoute(sideId);
  }
  return mainLineRoute(id === undefined ? null : decodedOrNull(id));
}

/** #/messages[/<id>[/profile]]、#/messages/requests（旧的 #/contacts… 同样）；旧的 #/messages/plasticine… 去主线。 */
function contactsRoute(id: string | undefined, sub: string | undefined, third?: string): Route {
  const pane = LIST_PANES.find((candidate) => candidate === id);
  if (pane !== undefined) {
    return messagesRoute(null, pane);
  }
  const contactId = id === undefined ? null : decodedOrNull(id);
  if (contactId === LEGACY_PLASTICINE_THREAD) {
    return sub === SIDE_SEGMENT ? plasticineRoute(SIDE_SEGMENT, third) : plasticineRoute(sub, undefined);
  }
  if (contactId !== null && sub === 'profile') {
    return messagesRoute(contactId, 'profile');
  }
  return messagesRoute(contactId);
}

/** 判断 id 那一段解不开就当没给（回到列表），不让整个壳渲染不出来。 */
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

/** #/books/<id>[/<章>/<字>]：位置那两段不是非负整数就当没给，照常打开这本书。 */
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

/**
 * 2026-11-05 删掉的页的旧地址落到哪：关切去项目，成果去笔记，系统去设置 · 系统，专注 / 日历 / 提醒回首页（旧任务的地址
 * 11-07 起是新的任务栏目，见 tasksRoute）。不是这几种返回 null。
 */
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
    if (route.lineId != null) return `#/plasticine/${SIDE_SEGMENT}/${encodeURIComponent(route.lineId)}`;
    return route.messageId == null ? '#/plasticine' : `#/plasticine/${encodeURIComponent(route.messageId)}`;
  }
  if (route.view === 'web') {
    return route.webTabId == null ? '#/web' : `#/web/${encodeURIComponent(route.webTabId)}`;
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
    return routeHash(mainLineRoute(route.messageId ?? null));
  }
  if (route.view === 'feed' && route.feedItemId != null) {
    return `#/feed/${encodeURIComponent(route.feedItemId)}`;
  }
  if (route.view === 'memory' && route.topicId != null) {
    return `#/memory/topics/${encodeURIComponent(route.topicId)}`;
  }
  if (route.view === 'memory' && route.memoryDream === true) {
    return '#/memory/dream';
  }
  if (route.view === 'memory' && route.objectType === 'agreement' && route.objectId == null) {
    return '#/memory/agreements';
  }
  if (route.view === 'projects' && route.projectId != null) {
    return `#/projects/${encodeURIComponent(route.projectId)}`;
  }
  if (route.view === 'books' && route.spacesList === true) {
    return `#/books/${SPACE_SEGMENT}`;
  }
  if (route.view === 'books' && route.spaceId != null) {
    return `#/books/${SPACE_SEGMENT}/${encodeURIComponent(route.spaceId)}`;
  }
  if (route.view === 'books' && route.bookId != null) {
    const position = route.bookPosition == null ? '' : `/${route.bookPosition.chapter}/${route.bookPosition.offset}`;
    return `#/books/${encodeURIComponent(route.bookId)}${position}`;
  }
  if (route.objectId != null && route.objectType !== undefined) {
    const paths = { memory_entry: 'memory/entries', agreement: 'memory/agreements' };
    return `#/${paths[route.objectType]}/${encodeURIComponent(route.objectId)}`;
  }
  if (route.view === 'memory' && route.termId !== undefined) {
    return route.termId === null ? '#/memory/terms' : `#/memory/terms/${encodeURIComponent(route.termId)}`;
  }
  if (route.view === 'notes' && route.noteId !== null) {
    return `#/notes/${encodeURIComponent(route.noteId)}`;
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
  const base = `#/messages/${encodeURIComponent(route.contactId)}`;
  return route.contactPane === 'profile' ? `${base}/profile` : base;
}

const VIEW_LABELS: Readonly<Record<ViewId, string>> = {
  today: '现在', plasticine: 'Plasticine', web: '网页', work: '工作', messages: '消息', conversation: '消息',
  contacts: '消息', projects: '项目', memory: '记忆', notes: '笔记', books: '资料库', feed: '信息流', browser: '浏览器',
  settings: '设置', tools: '工具', tasks: '任务',
};

export function navLabel(view: ViewId): string {
  return VIEW_LABELS[view];
}
