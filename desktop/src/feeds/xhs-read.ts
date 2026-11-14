// 小红书的两处（第13批，11-14 Aaron：加「小红书」，抓首页「推荐」和自己的收藏，按时间合并、去重，标「推荐」「收藏」，
// 两处都有就两个标都留）：先载入首页收推荐，再从首页认出自己、载入自己主页的收藏那一页收收藏（注入脚本是
// client/src/mac/xhs-page.ts，要在网页自己的脚本世界里跑，才读得到页面自带的初始数据）。同一条只交一次、带上在哪几处
// 看到的；没登录、要验证就停下说原因（不试着过验证）；收藏那一页没读到时首页读到的照交、记一行；两处都没读到才算没读成。
// 窗口怎么开、脚本怎么跑由调用方给（XhsPage）。

import type { XhsNote, XhsPlace, XhsReport } from '../../../agent/shared/api/index.ts';
import { XHS_NOTES_MAX } from '../../../agent/shared/api/index.ts';
import type { XhsListedNote } from '../../../client/src/mac/xhs-page.ts';

const EXPLORE = 'https://www.xiaohongshu.com/explore';
const PAGE_WAIT_MS = 20_000;
const SWITCH_WAIT_MS = 3_000;
const SCROLL_WAIT_MS = 2_500;
const SCROLLS = 4;
const POLL_MS = 1_000;

export interface XhsPage {
  /** 载入一页；载不出回原因。 */
  load(url: string): Promise<string | null>;
  /** 在网页自己的脚本世界里跑一段，回结果。 */
  run(code: string): Promise<unknown>;
}

export interface XhsReadOptions {
  /** 注入脚本（装好 window.__plasticineXhs）；每载一页装一次。 */
  script: string;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

type XhsError = NonNullable<XhsReport['error']>;

/** 载一页、装脚本、等它能读；回状态或没载出来的原因。 */
async function open(page: XhsPage, url: string, options: XhsReadOptions):
  Promise<{ state: string } | { error: XhsError }> {
  const problem = await page.load(url);
  if (problem !== null) { return { error: { code: 'load_failed', detail: problem.slice(0, 300) } }; }
  await page.run(options.script);
  let state = 'loading';
  for (let waited = 0; waited < PAGE_WAIT_MS && state === 'loading'; waited += POLL_MS) {
    state = String(await page.run('window.__plasticineXhs.state()'));
    if (state === 'loading') { await options.sleep(POLL_MS); }
  }
  if (state === 'signed_out' || state === 'verify') { return { error: { code: state } }; }
  return state === 'ready' ? { state } : { error: { code: 'layout_changed' } };
}

/** 一边往下翻一边收，回这一页的笔记。 */
async function collect(page: XhsPage, options: XhsReadOptions): Promise<XhsListedNote[]> {
  for (let index = 0; index < SCROLLS; index += 1) {
    await page.run('window.__plasticineXhs.collect()');
    await page.run('window.__plasticineXhs.scroll()');
    await options.sleep(SCROLL_WAIT_MS);
  }
  await page.run('window.__plasticineXhs.collect()');
  return await page.run('window.__plasticineXhs.notes()') as XhsListedNote[];
}

/** 把这一处读到的并进去：已有的加上这一处。 */
function merge(into: Map<string, XhsNote>, notes: readonly XhsListedNote[], place: XhsPlace): void {
  for (const note of notes) {
    const known = into.get(note.id);
    into.set(note.id, known === undefined ? { ...note, places: [place] }
      : { ...known, places: known.places.includes(place) ? known.places : [...known.places, place] });
  }
}

/** 读两处，合成一次要交的笔记和错误。 */
export async function readXhs(page: XhsPage, options: XhsReadOptions): Promise<Pick<XhsReport, 'notes' | 'error'>> {
  const notes = new Map<string, XhsNote>();
  const home = await open(page, EXPLORE, options);
  if ('error' in home) {
    return { notes: [], error: home.error };
  }
  merge(notes, await collect(page, options), 'recommend');
  const me = await page.run('window.__plasticineXhs.me()');
  if (typeof me !== 'string') {
    options.log('小红书：认不出你是谁，这次没读收藏');
  } else {
    const profile = await open(page, `https://www.xiaohongshu.com/user/profile/${me}?tab=fav&subTab=note`, options);
    if ('error' in profile) {
      options.log(`小红书「收藏」没读到：${profile.error.code}${profile.error.detail === undefined ? ''
        : `（${profile.error.detail}）`}`);
    } else {
      const switched = await page.run('window.__plasticineXhs.saved()');
      if (switched === null) {
        options.log('小红书「收藏」没读到：找不到「收藏」这一页');
      } else {
        if (switched === true) { await options.sleep(SWITCH_WAIT_MS); }
        merge(notes, await collect(page, options), 'saved');
      }
    }
  }
  if (notes.size === 0) { return { notes: [], error: { code: 'layout_changed' } }; }
  return { notes: [...notes.values()].slice(0, XHS_NOTES_MAX), error: null };
}
