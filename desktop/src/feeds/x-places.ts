import type { XPlace, XPost, XTimelineReport } from '../../../agent/shared/api/index.ts';
import { X_POSTS_MAX } from '../../../agent/shared/api/index.ts';

const HOME = 'https://x.com/home';
const BOOKMARKS = 'https://x.com/i/bookmarks';
const TIMELINE_WAIT_MS = 20_000;
const SWITCH_WAIT_MS = 4_000;
const SCROLL_WAIT_MS = 2_500;
const SCROLLS = 4;
const EXPAND_MAX = 8;
const EXPAND_WAIT_MS = 10_000;
const POLL_MS = 1_000;

const PLAN: readonly { place: XPlace; label: string; url: string; tab: 'following' | 'recommend' | null }[] = [
  { place: 'following', label: '正在关注', url: HOME, tab: 'following' },
  { place: 'recommend', label: '为你推荐', url: HOME, tab: 'recommend' },
  { place: 'bookmark', label: '书签', url: BOOKMARKS, tab: null },
];

export interface XPage {
  load(url: string): Promise<string | null>;
  run(code: string): Promise<unknown>;
}

export interface XReadOptions {
  script: string;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

type XError = NonNullable<XTimelineReport['error']>;
type Miss = { label: string; error: XError };

async function open(page: XPage, url: string, options: XReadOptions):
  Promise<{ state: string } | { problem: string }> {
  const problem = await page.load(url);
  if (problem !== null) { return { problem }; }
  await page.run(options.script);
  let state = 'loading';
  for (let waited = 0; waited < TIMELINE_WAIT_MS && state === 'loading'; waited += POLL_MS) {
    state = String(await page.run('window.__plasticineX.state()'));
    if (state === 'loading') { await options.sleep(POLL_MS); }
  }
  return { state };
}

async function collect(page: XPage, options: XReadOptions): Promise<{ posts: XPost[]; truncated: string[] }> {
  for (let index = 0; index < SCROLLS; index += 1) {
    await page.run('window.__plasticineX.collect()');
    await page.run('window.__plasticineX.scroll()');
    await options.sleep(SCROLL_WAIT_MS);
  }
  await page.run('window.__plasticineX.collect()');
  return {
    posts: await page.run('window.__plasticineX.posts()') as XPost[],
    truncated: await page.run('window.__plasticineX.truncated()') as string[],
  };
}

async function readPlace(page: XPage, plan: (typeof PLAN)[number], options: XReadOptions):
  Promise<{ posts: XPost[]; truncated: string[] } | { error: XError }> {
  const opened = await open(page, plan.url, options);
  if ('problem' in opened) {
    return { error: { code: 'load_failed', detail: opened.problem.slice(0, 300) } };
  }
  if (opened.state !== 'ready') {
    return { error: { code: opened.state === 'signed_out' ? 'signed_out' : 'layout_changed' } };
  }
  if (plan.tab !== null) {
    const switched = await page.run(`window.__plasticineX.${plan.tab}()`);
    if (switched === null) { return { error: { code: 'layout_changed', detail: `找不到「${plan.label}」这一栏` } }; }
    if (switched === true) { await options.sleep(SWITCH_WAIT_MS); }
  }
  return collect(page, options);
}

async function expand(page: XPage, posts: Map<string, XPost>, truncated: readonly string[],
  options: XReadOptions): Promise<void> {
  for (const id of truncated.slice(0, EXPAND_MAX)) {
    const post = posts.get(id);
    if (post === undefined) { continue; }
    const problem = await page.load(`https://x.com/${post.handle}/status/${id}`);
    if (problem !== null) {
      options.log(`X 长帖 ${id} 没补上全文：${problem}`);
      continue;
    }
    await page.run(options.script);
    for (let waited = 0; waited < EXPAND_WAIT_MS; waited += POLL_MS) {
      const text = await page.run(`window.__plasticineX.fullText(${JSON.stringify(id)})`);
      if (typeof text === 'string' && text.length > post.text.length) {
        post.text = text;
        break;
      }
      await options.sleep(POLL_MS);
    }
  }
}

export async function readXPlaces(page: XPage, options: XReadOptions):
  Promise<Pick<XTimelineReport, 'posts' | 'error'>> {
  const posts = new Map<string, XPost>();
  const truncated = new Set<string>();
  const misses: Miss[] = [];
  let readable = false;
  for (const plan of PLAN) {
    const read = await readPlace(page, plan, options);
    if ('error' in read) {
      if (read.error.code === 'signed_out') { return { posts: [], error: { code: 'signed_out' } }; }
      misses.push({ label: plan.label, error: read.error });
      options.log(`X「${plan.label}」没读到：${read.error.code}${read.error.detail === undefined ? ''
        : `（${read.error.detail}）`}`);
      continue;
    }
    readable = true;
    for (const post of read.posts) {
      const known = posts.get(post.id);
      const places = [...(known?.places ?? []), plan.place];
      const text = known !== undefined && known.text.length > post.text.length ? known.text : post.text;
      posts.set(post.id, { ...(known ?? post), text, places });
    }
    read.truncated.forEach((id) => truncated.add(id));
  }
  if (posts.size === 0) {
    return { posts: [], error: readable || misses[0] === undefined ? { code: 'layout_changed' } : misses[0].error };
  }
  await expand(page, posts, [...truncated], options);
  return { posts: [...posts.values()].slice(0, X_POSTS_MAX), error: null };
}
