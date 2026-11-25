import type { XhsNote } from '../api/shared.ts';

export type XhsListedNote = Omit<XhsNote, 'places'>;
export type XhsPageState = 'signed_out' | 'verify' | 'loading' | 'ready';

const TITLE_MAX = 200;
const AUTHOR_MAX = 100;
const RATIO_MIN = 0.2;
const RATIO_MAX = 5;
const ID = /^[0-9a-f]{24}$/;
const TOKEN = /^[A-Za-z0-9+/=_-]{1,200}$/;
const NOTE_PATH = /\/(?:explore|discovery\/item|search_result|user\/profile\/[0-9a-f]{24})\/([0-9a-f]{24})(?:[/?#]|$)/;
const SAVED_TAB_NAMES = ['收藏', 'Collections', 'Saved'];

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function unwrap(value: unknown): unknown {
  const box = object(value);
  if ('__v_isRef' in box || '_rawValue' in box || '_value' in box) {
    return box['_rawValue'] ?? box['_value'] ?? box['value'];
  }
  return value;
}

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

function token(value: unknown): { xsecToken: string } | Record<string, never> {
  return typeof value === 'string' && TOKEN.test(value) ? { xsecToken: value } : {};
}

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
    ...token(item['xsecToken'] ?? card['xsecToken']),
  };
}

export function exploreNotes(state: unknown): XhsListedNote[] {
  return array(at(state, ['feed', 'feeds'])).map(stateNote).filter((note) => note !== null);
}

export function savedNotes(state: unknown): XhsListedNote[] {
  return array(unwrap(array(at(state, ['user', 'notes']))[1])).map(stateNote).filter((note) => note !== null);
}

export function myId(state: unknown): string | null {
  const id = text(at(state, ['user', 'userInfo', 'userId']), 40);
  return ID.test(id) ? id : null;
}

export function cardNote(section: Element, base: string): XhsListedNote | null {
  let id = '';
  let xsec: string | null = null;
  for (const link of section.querySelectorAll('a[href]')) {
    const href = new URL(link.getAttribute('href') ?? '', base);
    const match = NOTE_PATH.exec(href.pathname);
    if (match === null || (id !== '' && match[1] !== id)) { continue; }
    id = match[1] ?? '';
    xsec = href.searchParams.get('xsec_token');
    if (xsec !== null && xsec !== '') { break; }
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
    ...token(xsec),
  };
}

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

export function chooseSaved(doc: Document): boolean | null {
  const tabs = [...doc.querySelectorAll<HTMLElement>('.reds-tab-item, [role="tab"], .tab-content-item')];
  const tab = tabs.find((candidate) => SAVED_TAB_NAMES.includes(candidate.textContent?.trim() ?? ''));
  if (tab === undefined) { return null; }
  if (tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true') { return false; }
  tab.click();
  return true;
}

function shown(element: Element): boolean {
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    if (current instanceof HTMLElement && (current.hidden || current.style.display === 'none')) { return false; }
  }
  return true;
}

export function collectNotes(doc: Document, base: string, state: unknown, seen: Map<string, XhsListedNote>): number {
  const fromState = new URL(base).pathname.startsWith('/user/profile') ? savedNotes(state) : exploreNotes(state);
  const fromCards = [...doc.querySelectorAll('section.note-item')].filter(shown)
    .map((section) => cardNote(section, base));
  for (const note of [...fromState, ...fromCards]) {
    if (note === null) { continue; }
    const known = seen.get(note.id);
    if (known === undefined) { seen.set(note.id, note); }
    else if (known.xsecToken === undefined && note.xsecToken !== undefined) {
      seen.set(note.id, { ...known, xsecToken: note.xsecToken });
    }
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
