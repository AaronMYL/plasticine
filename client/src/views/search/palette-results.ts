// ⌘K 的结果怎么分组（11-07 设计稿 Palette）：服务端统一索引（/v2/search）的结果按种类分组，再加上这台设备上的竖排标签、
// 旁聊和书签；顺序是 空间 · 旁聊 · 标签 · 书签 · 笔记 · 对话 · 记忆 · 信息流 · 图书，最后一组是「让 Plasticine 做」。
// 书签（第 8 批第 1 条，和标签分开）：索引按名字、正文快照、网址找到的在前，再补上名字、网址对得上的；只列网页书签。
// 每组最多几条（更多的在那一栏里找）；顺序就是相关程度（索引给的），这里不再按时间重排。

import type { LineView, SearchKind, SearchResult } from '../../api/shared.ts';
import type { ArchivedTab, WebTab } from '../../state/web-tabs.ts';
import { bookmarkTitle, type WebBookmark } from '../bookmarks/bookmark-address.ts';
import { mainLineRoute, sideRoute, type Route } from '../../shell/routes.ts';

export const PALETTE_GROUPS = [
  'space', 'side', 'tab', 'bookmark', 'note', 'message', 'memory', 'feed', 'book', 'ask',
] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export const GROUP_LABELS: Readonly<Record<PaletteGroup, string>> = {
  space: '空间', side: '队友与群组', tab: '标签', bookmark: '书签', note: '笔记', message: '对话', memory: '记忆',
  feed: '信息流', book: '图书', ask: '让 Plasticine 做',
};

/** 每组最多列几条。 */
export const GROUP_MAX = 4;

// 索引里的书签行另外对着这台设备上的书签列（bookmarkItems），这里不按通用的路由列。
const KIND_GROUP: Readonly<Record<SearchKind, PaletteGroup | null>> = {
  space: 'space', note: 'note', message: 'message', memory_doc: 'memory', agreement: 'memory', term: 'memory',
  feed_item: 'feed', book: 'book', bookmark: null,
};

export type PaletteTarget =
  | { kind: 'route'; route: Route }
  | { kind: 'tab'; id: string }
  | { kind: 'reopen'; key: string }
  | { kind: 'bookmark'; url: string; title: string }
  | { kind: 'ask'; text: string };

export interface PaletteItem {
  key: string;
  group: PaletteGroup;
  title: string;
  meta: string;
  /** 行首画什么：种类；网页标签带网址和标签 id（画网站图标）；空间带 id（按种类画图标）。 */
  lead: { kind: PaletteGroup; url?: string; tabId?: string; spaceId?: string };
  target: PaletteTarget;
}

/** 对话的一句（line:<线>:<seq>）点开去哪：主线跳到那一句，旁聊开那条旁聊，后台线开它的工作详情。 */
export function messageRoute(result: Pick<SearchResult, 'id' | 'lineKind'>): Route {
  const match = /^line:(.+):\d+$/.exec(result.id);
  const lineId = match?.[1] ?? null;
  if (lineId !== null && result.lineKind === 'side') return sideRoute(lineId);
  if (lineId !== null && result.lineKind === 'background') return { view: 'work', noteId: null, lineId };
  return mainLineRoute(result.id);
}

export function searchRoute(result: Pick<SearchResult, 'kind' | 'id' | 'lineKind'>): Route {
  const { id } = result;
  switch (result.kind) {
    case 'note': return { view: 'notes', noteId: id };
    case 'message': return messageRoute(result);
    case 'feed_item': return { view: 'feed', noteId: null, feedItemId: id };
    case 'bookmark': return { view: 'web', noteId: null, webTabId: null };
    case 'term': return { view: 'memory', noteId: null, termId: id };
    case 'memory_doc': return { view: 'memory', noteId: null, topicId: id };
    case 'agreement': return { view: 'memory', noteId: null, objectType: 'agreement', objectId: id };
    case 'space': return { view: 'books', noteId: null, bookId: null, spaceId: id };
    case 'book': return { view: 'books', noteId: null, bookId: id };
  }
}

function matches(text: string, needle: string): boolean {
  return text.toLocaleLowerCase().includes(needle);
}

export interface PaletteSources {
  query: string;
  results: readonly SearchResult[];
  tabs: readonly WebTab[];
  archived: readonly ArchivedTab[];
  /** 网页书签（BookmarkStore 里的）。 */
  bookmarks: readonly WebBookmark[];
  sides: readonly LineView[];
  /** 「今天」那几个标签（没打字时列它们）。 */
  today: readonly string[];
  dayText: (iso: string) => string;
}

function tabItem(tab: WebTab, meta: string): PaletteItem {
  return { key: `tab:${tab.id}`, group: 'tab', title: tab.title.trim() === '' ? tab.url : tab.title, meta,
    lead: { kind: 'tab', url: tab.url, tabId: tab.id }, target: { kind: 'tab', id: tab.id } };
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (cause) {
    console.warn('书签的网址解不开，不写网站名', cause);
    return '';
  }
}

function bookmarkItem(bookmark: WebBookmark): PaletteItem {
  const title = bookmarkTitle(bookmark);
  return { key: `bookmark:${bookmark.id}`, group: 'bookmark', title, meta: siteOf(bookmark.target),
    lead: { kind: 'bookmark', url: bookmark.target }, target: { kind: 'bookmark', url: bookmark.target, title } };
}

/** 书签：索引找到的（按相关程度）在前，再补名字、网址对得上的；不是网页书签的不列。 */
function bookmarkItems(sources: PaletteSources, needle: string): PaletteItem[] {
  const byId = new Map(sources.bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const found = sources.results.filter((result) => result.kind === 'bookmark')
    .flatMap((result) => byId.get(result.id) ?? []);
  const matched = sources.bookmarks.filter((bookmark) => matches(`${bookmark.title} ${bookmark.target}`, needle));
  return [...new Set([...found, ...matched])].map(bookmarkItem);
}

function sideItem(line: LineView, dayText: (iso: string) => string): PaletteItem {
  return { key: `side:${line.id}`, group: 'side', title: line.title, meta: dayText(line.updatedAt),
    lead: { kind: 'side' }, target: { kind: 'route', route: sideRoute(line.id) } };
}

/** 按组排好、每组截到 GROUP_MAX 的一张平表（键盘上下按这个顺序走）。 */
export function paletteItems(sources: PaletteSources): PaletteItem[] {
  const needle = sources.query.trim().toLocaleLowerCase();
  const items: PaletteItem[] = [];
  if (needle === '') {
    const today = sources.today.flatMap((id) => sources.tabs.filter((tab) => tab.id === id));
    items.push(...sources.sides.slice(0, GROUP_MAX).map((line) => sideItem(line, sources.dayText)));
    items.push(...today.slice(0, GROUP_MAX).map((tab) => tabItem(tab, '网页 · 今天')));
    return items;
  }
  for (const result of sources.results) {
    const group = KIND_GROUP[result.kind];
    if (group === null) continue;
    items.push({ key: `${result.kind}:${result.id}`, group, title: result.title,
      meta: result.detail === '' ? sources.dayText(result.updatedAt) : result.detail,
      lead: result.kind === 'space' ? { kind: group, spaceId: result.id } : { kind: group },
      target: { kind: 'route', route: searchRoute(result) } });
  }
  items.push(...sources.sides.filter((line) => matches(line.title, needle)).map((line) => sideItem(line,
    sources.dayText)));
  const today = new Set(sources.today);
  items.push(...sources.tabs.filter((tab) => matches(`${tab.title} ${tab.url}`, needle))
    .map((tab) => tabItem(tab, today.has(tab.id) ? '网页 · 今天' : '网页')));
  items.push(...bookmarkItems(sources, needle));
  items.push(...sources.archived.filter((entry) => matches(`${entry.title} ${entry.url}`, needle))
    .map((entry): PaletteItem => ({ key: `closed:${entry.key}`, group: 'tab',
      title: entry.title.trim() === '' ? entry.url : entry.title, meta: '关掉的',
      lead: { kind: 'tab', url: entry.url }, target: { kind: 'reopen', key: entry.key } })));
  const grouped = PALETTE_GROUPS.flatMap((group) => items.filter((item) => item.group === group)
    .slice(0, GROUP_MAX));
  grouped.push({ key: 'ask', group: 'ask', title: `「${sources.query.trim()}」`, meta: '', lead: { kind: 'ask' },
    target: { kind: 'ask', text: sources.query.trim() } });
  return grouped;
}
