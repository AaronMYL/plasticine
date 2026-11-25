import type { XPost } from '../api/shared.ts';

export type XTimelinePost = XPost;

export type XTimelineState = 'signed_out' | 'loading' | 'ready';

const TEXT_MAX_CHARS = 4_000;
const IMAGES_MAX = 4;
const RATIO_MIN = 0.2;
const RATIO_MAX = 5;
const STATUS_PATH = /^\/([A-Za-z0-9_]{1,30})\/status\/(\d{1,30})(?:\/|$)/;
const FOLLOWING_TAB_NAMES = ['Following', '正在关注', '关注', '關注中', 'フォロー中'];
const RECOMMEND_TAB_NAMES = ['For you', '为你推荐', '推荐', '為你推薦', 'おすすめ'];

function https(raw: string | null | undefined, base: string): string | null {
  if (raw === null || raw === undefined || raw === '') { return null; }
  try {
    const url = new URL(raw, base);
    return url.protocol === 'https:' ? url.href : null;
  } catch (cause) {
    if (cause instanceof TypeError) { return null; }
    throw cause;
  }
}

function textOf(node: Element | null): string {
  if (node === null) { return ''; }
  let text = '';
  const walk = (current: Node): void => {
    if (current.nodeType === 3) {
      text += current.nodeValue ?? '';
    } else if (current instanceof HTMLImageElement) {
      text += current.alt;
    } else if (current instanceof HTMLBRElement) {
      text += '\n';
    } else {
      current.childNodes.forEach(walk);
    }
  };
  walk(node);
  return text.trim().slice(0, TEXT_MAX_CHARS);
}

function ratioOf(image: HTMLImageElement): number | null {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) { return null; }
  const ratio = image.naturalHeight / image.naturalWidth;
  return ratio >= RATIO_MIN && ratio <= RATIO_MAX ? Math.round(ratio * 1000) / 1000 : null;
}

function photosOf(article: Element, base: string): { url: string; ratio: number | null }[] {
  const photos: { url: string; ratio: number | null }[] = [];
  for (const photo of article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img')) {
    const url = https(photo.getAttribute('src'), base);
    if (url === null || photos.some((known) => known.url === url)) { continue; }
    photos.push({ url, ratio: ratioOf(photo) });
    if (photos.length === IMAGES_MAX) { break; }
  }
  return photos;
}

export function readPost(article: Element, base: string): XTimelinePost | null {
  const time = article.querySelector('time[datetime]');
  const link = time?.closest('a[href]')?.getAttribute('href') ?? null;
  const match = link === null ? null : STATUS_PATH.exec(new URL(link, base).pathname);
  if (time === null || match === null) { return null; }
  const handle = match[1] ?? '';
  const names = article.querySelector('[data-testid="User-Name"]');
  const author = names?.querySelector('a[href] span')?.textContent?.trim() || handle;
  const avatar = article.querySelector<HTMLImageElement>('[data-testid="Tweet-User-Avatar"] img');
  const images = photosOf(article, base);
  const at = Date.parse(time.getAttribute('datetime') ?? '');
  return {
    id: match[2] ?? '',
    handle,
    author: author.slice(0, 200),
    avatar: https(avatar?.getAttribute('src'), base),
    text: textOf(article.querySelector('[data-testid="tweetText"]')),
    image: images[0]?.url ?? null,
    imageRatio: images[0]?.ratio ?? null,
    images,
    publishedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
  };
}

export function timelineState(doc: Document, location: string): XTimelineState {
  const path = new URL(location).pathname;
  if (path.startsWith('/login') || path.startsWith('/i/flow/login') || path === '/'
    || doc.querySelector('[data-testid="loginButton"], [data-testid="signupButton"]') !== null) {
    return 'signed_out';
  }
  return doc.querySelector('[data-testid="primaryColumn"]') === null ? 'loading' : 'ready';
}

function chooseTab(doc: Document, names: readonly string[]): boolean | null {
  const tabs = [...doc.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];
  const tab = tabs.find((candidate) => names.includes(candidate.textContent?.trim() ?? ''));
  if (tab === undefined) { return null; }
  if (tab.getAttribute('aria-selected') === 'true') { return false; }
  tab.click();
  return true;
}

export function chooseFollowing(doc: Document): boolean | null {
  return chooseTab(doc, FOLLOWING_TAB_NAMES);
}

export function chooseRecommend(doc: Document): boolean | null {
  return chooseTab(doc, RECOMMEND_TAB_NAMES);
}

export function isTruncated(article: Element): boolean {
  return article.querySelector('[data-testid="tweet-text-show-more-link"]') !== null;
}

export function collectPosts(doc: Document, base: string, seen: Map<string, XTimelinePost>,
  truncated: Set<string> = new Set()): number {
  for (const article of doc.querySelectorAll('article[data-testid="tweet"]')) {
    const post = readPost(article, base);
    if (post === null || seen.has(post.id)) { continue; }
    seen.set(post.id, post);
    if (isTruncated(article)) { truncated.add(post.id); }
  }
  return seen.size;
}

export function fullText(doc: Document, base: string, id: string): string | null {
  for (const article of doc.querySelectorAll('article[data-testid="tweet"]')) {
    const post = readPost(article, base);
    if (post?.id !== id) { continue; }
    return isTruncated(article) || post.text === '' ? null : post.text;
  }
  return null;
}

export interface XTimelineReader {
  state(): XTimelineState;
  following(): boolean | null;
  recommend(): boolean | null;
  collect(): number;
  scroll(): void;
  posts(): XTimelinePost[];
  truncated(): string[];
  fullText(id: string): string | null;
}

export function installTimelineReader(win: Window): XTimelineReader {
  const seen = new Map<string, XTimelinePost>();
  const truncated = new Set<string>();
  return {
    state: () => timelineState(win.document, win.location.href),
    following: () => chooseFollowing(win.document),
    recommend: () => chooseRecommend(win.document),
    collect: () => collectPosts(win.document, win.location.href, seen, truncated),
    scroll: () => win.scrollBy(0, win.innerHeight * 0.9),
    posts: () => [...seen.values()],
    truncated: () => [...truncated],
    fullText: (id) => fullText(win.document, win.location.href, id),
  };
}
