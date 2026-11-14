// 小红书的取数脚本（第13批，11-14 Aaron：加「小红书」，抓首页「推荐」和自己的收藏，合并、去重，标「推荐」「收藏」）。
// 电脑客户端到点了，在一个看不见的窗口里先载入首页（/explore），再载入自己主页的收藏（/user/profile/<自己>?tab=fav），
// 用和网页标签同一份登录，在网页自己的脚本世界里跑这一段：先看页面状态（没登录、要验证、还在载入、能读了），再一边
// 往下翻一边收笔记——标题、作者、头像、封面、是不是视频——交回去，再交给服务端（agent/shared/api/feed-xhs.ts 的
// XhsNote）。先读页面自带的初始数据（window.__INITIAL_STATE__；值常包在 Vue 的 ref 里：_rawValue / _value），再读页面上
// 的笔记卡片，补上往下翻出来的。只读，不点赞、不收藏；碰到验证就停，不试着过。desktop/build/bundle.ts 把它打成
// dist/pages/xhs.js。小红书改版时最先坏的是这些字段名和选择器：读不到时报 layout_changed。

import type { XhsNote } from '../api/shared.ts';

/** 交回去的一条笔记：在哪一处看到的由读的那一方加上。 */
export type XhsListedNote = Omit<XhsNote, 'places'>;
export type XhsPageState = 'signed_out' | 'verify' | 'loading' | 'ready';

// 和 feed-xhs.ts、state-daily.ts 的上限一致（注入脚本里不 import 运行时的东西；测试按服务端的 schema 核对）。
const TITLE_MAX = 200;
const AUTHOR_MAX = 100;
const RATIO_MIN = 0.2;
const RATIO_MAX = 5;
const ID = /^[0-9a-f]{24}$/;
const NOTE_PATH = /\/(?:explore|discovery\/item|search_result|user\/profile\/[0-9a-f]{24})\/([0-9a-f]{24})(?:[/?#]|$)/;
const SAVED_TAB_NAMES = ['收藏', 'Collections', 'Saved'];

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 取 Vue ref 里的值（初始数据里有的是 ref，有的已经是原样的值）。 */
export function unwrap(value: unknown): unknown {
  const box = object(value);
  if ('__v_isRef' in box || '_rawValue' in box || '_value' in box) {
    return box['_rawValue'] ?? box['_value'] ?? box['value'];
  }
  return value;
}

/** 顺着路径往下取，每一层都先拆 ref。 */
function at(root: unknown, path: readonly string[]): unknown {
  let current = unwrap(root);
  for (const key of path) {
    current = unwrap(object(current)[key]);
  }
  return current;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function https(raw: unknown, base = 'https://www.xiaohongshu.com/'): string | null {
  if (typeof raw !== 'string' || raw === '') { return null; }
  try {
    const url = new URL(raw.replace(/^http:/, 'https:'), base);
    return url.protocol === 'https:' ? url.href : null;
  } catch (cause) {
    if (cause instanceof TypeError) { return null; }
    throw cause;
  }
}

function ratio(width: unknown, height: unknown): number | null {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) { return null; }
  const value = h / w;
  return value >= RATIO_MIN && value <= RATIO_MAX ? Math.round(value * 1000) / 1000 : null;
}

/** 初始数据里的一条：首页是 { id, modelType, noteCard }，主页的收藏是 { noteCard } 或直接摊开的那一层。 */
export function stateNote(raw: unknown): XhsListedNote | null {
  const item = object(unwrap(raw));
  if (item['modelType'] !== undefined && item['modelType'] !== 'note') { return null; }
  const card = object(unwrap(item['noteCard'] ?? item));
  const id = text(item['id'] ?? card['noteId'] ?? item['noteId'], 40);
  const user = object(card['user']);
  const author = text(user['nickname'] ?? user['nickName'] ?? user['name'], AUTHOR_MAX);
  if (!ID.test(id) || author === '') { return null; }
  const cover = object(card['cover']);
  const image = https(cover['urlDefault'] ?? cover['url'] ?? object(array(cover['infoList'])[0])['url']);
  return {
    id,
    title: text(card['displayTitle'] ?? card['title'], TITLE_MAX),
    author,
    avatar: https(user['avatar'] ?? user['image']),
    image,
    imageRatio: image === null ? null : ratio(cover['width'], cover['height']),
    video: card['type'] === 'video',
  };
}

/** 首页初始数据里的推荐笔记（feed.feeds）。 */
export function exploreNotes(state: unknown): XhsListedNote[] {
  return array(at(state, ['feed', 'feeds'])).map(stateNote).filter((note) => note !== null);
}

/** 主页初始数据里的收藏（user.notes 按标签页排：笔记、收藏、赞过；只取收藏那一页）。 */
export function savedNotes(state: unknown): XhsListedNote[] {
  return array(unwrap(array(at(state, ['user', 'notes']))[1])).map(stateNote).filter((note) => note !== null);
}

/** 自己的用户标识（拼收藏页的地址）；没登录、认不出是 null。 */
export function myId(state: unknown): string | null {
  const id = text(at(state, ['user', 'userInfo', 'userId']), 40);
  return ID.test(id) ? id : null;
}

/** 页面上的一张笔记卡片（往下翻出来的）。 */
export function cardNote(section: Element, base: string): XhsListedNote | null {
  let id = '';
  for (const link of section.querySelectorAll('a[href]')) {
    const match = NOTE_PATH.exec(new URL(link.getAttribute('href') ?? '', base).pathname);
    if (match !== null) {
      id = match[1] ?? '';
      break;
    }
  }
  const author = text(section.querySelector('.author .name, .author-wrapper .name, .name')?.textContent, AUTHOR_MAX);
  if (!ID.test(id) || author === '') { return null; }
  const cover = section.querySelector<HTMLImageElement>('a.cover img, .cover img');
  const image = https(cover?.getAttribute('src'), base);
  const avatar = section.querySelector<HTMLImageElement>('.author img, .author-avatar');
  return {
    id,
    title: text(section.querySelector('.title span, .title, .footer .title')?.textContent, TITLE_MAX),
    author,
    avatar: https(avatar?.getAttribute('src'), base),
    image,
    imageRatio: image === null ? null
      : ratio(section.getAttribute('data-width'), section.getAttribute('data-height')),
    video: section.querySelector('.play-icon, [class*="play-icon"]') !== null,
  };
}

/** 页面现在是什么样：要验证（验证页）、没登录（登录框、初始数据说没登录）、还在载入、能读了。 */
export function pageState(doc: Document, location: string, state: unknown): XhsPageState {
  const url = new URL(location);
  if (url.pathname.includes('captcha') || url.searchParams.has('verifyUuid')
    || doc.querySelector('.red-captcha, [class*="captcha-container"]') !== null) {
    return 'verify';
  }
  if (url.pathname.startsWith('/login') || at(state, ['user', 'loggedIn']) === false
    || doc.querySelector('.login-container, .login-modal') !== null) {
    return 'signed_out';
  }
  const listed = doc.querySelector('section.note-item') !== null || exploreNotes(state).length > 0
    || savedNotes(state).length > 0;
  return listed ? 'ready' : 'loading';
}

/** 主页上切到「收藏」那一页：已经在就不点；点了回 true（等它载完再读）。找不到回 null。 */
export function chooseSaved(doc: Document): boolean | null {
  const tabs = [...doc.querySelectorAll<HTMLElement>('.reds-tab-item, [role="tab"], .tab-content-item')];
  const tab = tabs.find((candidate) => SAVED_TAB_NAMES.includes(candidate.textContent?.trim() ?? ''));
  if (tab === undefined) { return null; }
  if (tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true') { return false; }
  tab.click();
  return true;
}

/** 藏着的（主页上没切到的那一页，v-show 是行内 display: none）不算。 */
function shown(element: Element): boolean {
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    if (current instanceof HTMLElement && (current.hidden || current.style.display === 'none')) { return false; }
  }
  return true;
}

/** 收一遍：初始数据（首页读推荐，主页读收藏那一页）+ 页面上看得见的卡片，按笔记标识去重，先见到的为准。 */
export function collectNotes(doc: Document, base: string, state: unknown, seen: Map<string, XhsListedNote>): number {
  const fromState = new URL(base).pathname.startsWith('/user/profile') ? savedNotes(state) : exploreNotes(state);
  const fromCards = [...doc.querySelectorAll('section.note-item')].filter(shown)
    .map((section) => cardNote(section, base));
  for (const note of [...fromState, ...fromCards]) {
    if (note !== null && !seen.has(note.id)) { seen.set(note.id, note); }
  }
  return seen.size;
}

export interface XhsReader {
  state(): XhsPageState;
  me(): string | null;
  saved(): boolean | null;
  collect(): number;
  scroll(): void;
  notes(): XhsListedNote[];
}

/** 装到 window 上给读的那一方一步步调：state → (首页) collect → scroll … → notes；换页后重新装，seen 不跨页。 */
export function installXhsReader(win: Window & typeof globalThis): XhsReader {
  const seen = new Map<string, XhsListedNote>();
  const initial = (): unknown => (win as unknown as { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__;
  return {
    state: () => pageState(win.document, win.location.href, initial()),
    me: () => myId(initial()),
    saved: () => chooseSaved(win.document),
    collect: () => collectNotes(win.document, win.location.href, initial(), seen),
    scroll: () => win.scrollBy(0, win.innerHeight * 0.9),
    notes: () => [...seen.values()],
  };
}
