// X 的三处（第13批，11-14 Aaron：「X 关注」改成「X」，抓「正在关注」「为你推荐」「书签」三处，按时间合并、去重，
// 标明来自哪里）：依次载入首页切「正在关注」、首页切「为你推荐」、书签页，每处往下翻几屏收帖子（注入脚本是
// client/src/mac/x-timeline-page.ts）。同一条只交一次、带上在哪几处看到的；没登录就停；哪一处没读到跳过那一处、记一行；
// 三处都没读到才算这次没读成。读完再把只露一段的长帖一条条载入帖子页补全文。窗口怎么开、脚本怎么跑由调用方给（XPage）。

import type { XPlace, XPost, XTimelineReport } from '../../../agent/shared/api/index.ts';
import { X_POSTS_MAX } from '../../../agent/shared/api/index.ts';

const HOME = 'https://x.com/home';
const BOOKMARKS = 'https://x.com/i/bookmarks';
const TIMELINE_WAIT_MS = 20_000;
const SWITCH_WAIT_MS = 4_000;
const SCROLL_WAIT_MS = 2_500;
const SCROLLS = 4;
/** 长帖一次最多补这么多条全文（一条要载一页）；补全文时每条最多等这么久。 */
const EXPAND_MAX = 8;
const EXPAND_WAIT_MS = 10_000;
const POLL_MS = 1_000;

/** 读的次序：先关注（最要紧），再推荐，最后书签页。 */
const PLAN: readonly { place: XPlace; label: string; url: string; tab: 'following' | 'recommend' | null }[] = [
  { place: 'following', label: '正在关注', url: HOME, tab: 'following' },
  { place: 'recommend', label: '为你推荐', url: HOME, tab: 'recommend' },
  { place: 'bookmark', label: '书签', url: BOOKMARKS, tab: null },
];

export interface XPage {
  /** 载入一页；载不出回原因。 */
  load(url: string): Promise<string | null>;
  /** 在 X 那一页的独立脚本世界里跑一段，回结果。 */
  run(code: string): Promise<unknown>;
}

export interface XReadOptions {
  /** 注入脚本（装好 window.__plasticineX）；每载一页装一次。 */
  script: string;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

type XError = NonNullable<XTimelineReport['error']>;
type Miss = { label: string; error: XError };

/** 载一页、装脚本、等它能读；回状态或没载出来的原因。 */
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

/** 一边往下翻一边收，回这一处的帖子和只露一段的那些。 */
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

/** 一处读成了回帖子；没读成回原因（没登录要整个停下）。 */
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
    // 找不到这一栏：不读当前那一栏充数，免得标错在哪看到的。
    if (switched === null) { return { error: { code: 'layout_changed', detail: `找不到「${plan.label}」这一栏` } }; }
    if (switched === true) { await options.sleep(SWITCH_WAIT_MS); }
  }
  return collect(page, options);
}

/** 只露一段的长帖：一条条载入帖子页、读全文换上；载不出、读不到的留着时间线上那一段。 */
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

/** 读三处，合成一次要交的帖子和错误。 */
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
    // 三处都没读到：有一页能读只是没收到帖子，多半是 X 改版；都没载出来就说没载出来。
    return { posts: [], error: readable || misses[0] === undefined ? { code: 'layout_changed' } : misses[0].error };
  }
  await expand(page, posts, [...truncated], options);
  return { posts: [...posts.values()].slice(0, X_POSTS_MAX), error: null };
}
