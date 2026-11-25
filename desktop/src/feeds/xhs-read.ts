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
  load(url: string): Promise<string | null>;
  run(code: string): Promise<unknown>;
}

export interface XhsReadOptions {
  script: string;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

type XhsError = NonNullable<XhsReport['error']>;

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

async function collect(page: XhsPage, options: XhsReadOptions): Promise<XhsListedNote[]> {
  for (let index = 0; index < SCROLLS; index += 1) {
    await page.run('window.__plasticineXhs.collect()');
    await page.run('window.__plasticineXhs.scroll()');
    await options.sleep(SCROLL_WAIT_MS);
  }
  await page.run('window.__plasticineXhs.collect()');
  return await page.run('window.__plasticineXhs.notes()') as XhsListedNote[];
}

function merge(into: Map<string, XhsNote>, notes: readonly XhsListedNote[], place: XhsPlace): void {
  for (const note of notes) {
    const known = into.get(note.id);
    const xsec = known?.xsecToken ?? note.xsecToken;
    into.set(note.id, known === undefined ? { ...note, places: [place] }
      : { ...known, places: known.places.includes(place) ? known.places : [...known.places, place],
        ...(xsec === undefined ? {} : { xsecToken: xsec }) });
  }
}

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
