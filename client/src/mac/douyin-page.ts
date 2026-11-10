// 抖音收藏的取数脚本（《优化清单》第 9 条，用户 11-07 定：用他 Mac 上 Plasticine 浏览器里已登录的状态取）。
// Mac 在线时问服务端要活（GET /v2/nodes/douyin，见 agent/shared/api/video.ts），在一个看不见的网页视图里载入
// https://www.douyin.com/（和网页标签同一份登录），在网页自己的脚本世界（main world）里跑这一段：网页会给自己发出的请求
// 签名（a_bogus），我们借它的 XMLHttpRequest 调抖音网页版自己用的接口，不另算签名。做法参考开源项目 TikTokDownloader
// （JoeanAmier）的 Web API：收藏作品 /aweme/v1/web/aweme/listcollection/、收藏夹 /aweme/v1/web/collects/list/、
// 收藏夹里的作品 /aweme/v1/web/collects/video/list/、作品详情 /aweme/v1/web/aweme/detail/。只读，不点、不改任何东西。
//
//   list：先翻收藏夹，再按收藏时间翻收藏作品（新的在前），翻到 sinceIds 里的（上次同步过的）就停；只要标题、作者、
//         收藏时间、列表位置、链接这些，不取下载地址；full 全量回填时不在 sinceIds 停下。
//   resolve：取一条作品的下载地址（无水印的视频地址、图文的图片、自带字幕）。地址可能绑登录或 IP，服务器上下载不了就记原因。
//
// 第四段 Electron 壳实现原生那一侧：载入页面、注入这段、按 jobs 调 installDouyinReader 的方法、把结果 POST 回去。
// 抖音改版时最先坏的是这些字段名：读不到时原生层报 layout_changed。

import type { DouyinFolderView, DouyinListedWork, DouyinResolved } from '../api/shared.ts';

const ORIGIN = 'https://www.douyin.com';
/** 和 shared/api/video.ts 的上限一致（脚本里不 import 运行时的东西，测试按 schema 核对）。 */
const TITLE_MAX = 1_000;
const CAPTION_MAX = 5_000;
const IMAGES_MAX = 40;
/** 一页要几条：网页版自己翻收藏也是这么多。 */
const PAGE_COUNT = 18;
/** 防止接口异常无限翻页；到达上限仍有下一页时明确报错，不把截断列表当全量结果。 */
const PAGES_MAX = 1_000;
/** 抖音图文作品的 aweme_type。 */
const IMAGE_POST_TYPES = new Set([2, 68, 150]);
/** 网页版的固定参数（TikTokDownloader 的 PARAMS 里同样这些）。 */
const COMMON_PARAMS: Readonly<Record<string, string>> = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1', version_code: '170400',
  version_name: '17.4.0', cookie_enabled: 'true', platform: 'PC', downlink: '10',
};

export type DouyinPageState = 'signed_out' | 'ready';

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function https(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') { return null; }
  try {
    const url = new URL(value.replace(/^http:/, 'https:'));
    return url.protocol === 'https:' ? url.href : null;
  } catch (cause) {
    if (cause instanceof TypeError) { return null; }
    throw cause;
  }
}

function firstUrl(holder: unknown): string | null {
  for (const url of array(object(holder)['url_list'])) {
    const found = https(url);
    if (found !== null) { return found; }
  }
  return null;
}

function workIdOf(aweme: Json): string | null {
  const id = text(aweme['aweme_id']) || String(aweme['aweme_id'] ?? '');
  return /^[0-9]{6,30}$/.test(id) ? id : null;
}

function kindOf(aweme: Json): 'video' | 'images' {
  return IMAGE_POST_TYPES.has(Number(aweme['aweme_type'])) || array(aweme['images']).length > 0 ? 'images' : 'video';
}

/** 秒；接口给的是毫秒。 */
function durationOf(aweme: Json): number | null {
  const ms = Number(object(aweme['video'])['duration'] ?? aweme['duration']);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 100) / 10 : null;
}

function isoOf(seconds: unknown): string | null {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
}

/** 收藏列表里的一条 → 交给服务端的样子。认不出作品 ID 的给 null。 */
export function listedWork(raw: unknown, folderId: string | null, listPosition = 0): DouyinListedWork | null {
  const aweme = object(raw);
  const workId = workIdOf(aweme);
  if (workId === null) { return null; }
  const caption = text(aweme['desc']).trim();
  const title = text(aweme['preview_title']).trim() || caption.split('\n')[0]?.replace(/#\S+/g, '').trim() || '';
  const author = text(object(aweme['author'])['nickname']).trim();
  return {
    workId,
    title: title.slice(0, TITLE_MAX),
    caption: caption.slice(0, CAPTION_MAX),
    author: author === '' ? null : author.slice(0, 200),
    kind: kindOf(aweme),
    durationSeconds: durationOf(aweme),
    collectedAt: isoOf(aweme['collect_time']),
    publishedAt: isoOf(aweme['create_time']),
    listPosition,
    folderIds: folderId === null ? [] : [folderId],
  };
}

export function folderOf(raw: unknown): DouyinFolderView | null {
  const folder = object(raw);
  const id = text(folder['collects_id_str']) || String(folder['collects_id'] ?? '');
  const name = text(folder['collects_name']).trim();
  if (!/^[0-9]{1,30}$/.test(id) || name === '') { return null; }
  const count = Number(folder['total_number']);
  return { id, name: name.slice(0, 200), count: Number.isInteger(count) && count >= 0 ? count : null };
}

/** 作品详情 → 下载地址。视频取最高码率那一路的无水印地址；图文取每张图的第一个地址；自带字幕有就带上。 */
export function resolvedWork(raw: unknown): DouyinResolved | null {
  const aweme = object(object(raw)['aweme_detail']);
  const workId = workIdOf(aweme);
  if (workId === null) { return null; }
  const video = object(aweme['video']);
  const kind = kindOf(aweme);
  const rates = array(video['bit_rate']).map(object)
    .sort((a, b) => Number(b['bit_rate'] ?? 0) - Number(a['bit_rate'] ?? 0));
  const best = rates.map((rate) => firstUrl(rate['play_addr'])).find((url) => url !== null) ?? null;
  const play = best ?? firstUrl(video['play_addr']);
  const images = array(aweme['images']).map((image) => firstUrl(image)).filter((url): url is string => url !== null);
  const subtitles = array(video['subtitle_infos']).map(object).flatMap((info) => {
    const url = https(info['Url'] ?? info['url']);
    const format = text(info['Format'] ?? info['format']).toLowerCase();
    if (url === null) { return []; }
    const kind: 'srt' | 'vtt' | 'json' = format === 'srt' || format === 'vtt' ? format : 'json';
    return [{ lang: text(info['LanguageCodeName'] ?? info['language']) || 'zh', url, format: kind }];
  });
  return {
    workId,
    kind,
    caption: text(aweme['desc']).slice(0, CAPTION_MAX),
    videoUrl: kind === 'video' ? play : null,
    images: images.slice(0, IMAGES_MAX),
    subtitles: subtitles.slice(0, 10),
    durationSeconds: durationOf(aweme),
  };
}

/** 接口回来是不是「没登录」：status_code 8 或 2483、或者回登录页。 */
export function signedOut(body: unknown): boolean {
  const code = Number(object(body)['status_code']);
  return code === 8 || code === 2483;
}

export interface DouyinCall {
  (path: string, params: Readonly<Record<string, string>>, method?: 'GET' | 'POST'): Promise<unknown>;
}

/** 在网页自己的脚本世界里发请求（网页会给它签名）。 */
export function pageCall(win: Window & typeof globalThis): DouyinCall {
  return (path, params, method = 'GET') => new Promise((resolve, reject) => {
    const query = new URLSearchParams({ ...COMMON_PARAMS, ...params });
    const request = new win.XMLHttpRequest();
    const url = method === 'GET' ? `${ORIGIN}${path}?${query.toString()}` : `${ORIGIN}${path}?${new URLSearchParams(
      COMMON_PARAMS).toString()}`;
    request.open(method, url);
    request.withCredentials = true;
    request.responseType = 'text';
    if (method === 'POST') {
      request.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
    }
    request.onload = () => {
      try {
        resolve(request.responseText === '' ? {} : JSON.parse(request.responseText));
      } catch (cause) {
        reject(new Error('layout_changed', { cause }));
      }
    };
    request.onerror = () => reject(new Error('load_failed'));
    request.send(method === 'POST' ? new URLSearchParams(params).toString() : null);
  });
}

export interface DouyinListResult {
  folders: DouyinFolderView[];
  works: DouyinListedWork[];
}

async function pages(call: DouyinCall, path: string, base: Readonly<Record<string, string>>, method: 'GET' | 'POST',
  stop: (aweme: unknown) => boolean, take: (aweme: unknown) => void): Promise<void> {
  let cursor = '0';
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const body = object(await call(path, { ...base, cursor, count: String(PAGE_COUNT) }, method));
    if (signedOut(body)) { throw new Error('signed_out'); }
    const list = array(body['aweme_list']);
    for (const aweme of list) {
      if (stop(aweme)) { return; }
      take(aweme);
    }
    if (Number(body['has_more']) !== 1 || list.length === 0) { return; }
    const nextCursor = String(body['cursor'] ?? body['max_cursor'] ?? '0');
    if (nextCursor === cursor) { throw new Error('layout_changed'); }
    cursor = nextCursor;
  }
  throw new Error('layout_changed');
}

/** 翻收藏夹和收藏作品：翻到 sinceIds 里的就停。同一条在收藏夹里也在总收藏里，按作品 ID 合并收藏夹。 */
export async function listFavorites(call: DouyinCall, sinceIds: readonly string[], full = false):
  Promise<DouyinListResult> {
  const known = new Set(sinceIds);
  const works = new Map<string, DouyinListedWork>();
  const folders: DouyinFolderView[] = [];
  const foldersBody = object(await call('/aweme/v1/web/collects/list/', { cursor: '0', count: '50' }));
  if (signedOut(foldersBody)) { throw new Error('signed_out'); }
  for (const raw of array(foldersBody['collects_list'])) {
    const folder = folderOf(raw);
    if (folder !== null) { folders.push(folder); }
  }
  let listPosition = 0;
  const add = (folderId: string | null) => (aweme: unknown): void => {
    const work = listedWork(aweme, folderId, listPosition++);
    if (work === null) { return; }
    const existing = works.get(work.workId);
    works.set(work.workId, existing === undefined ? work
      : { ...existing, folderIds: [...new Set([...existing.folderIds, ...work.folderIds])] });
  };
  const seen = (aweme: unknown): boolean => !full && known.has(workIdOf(object(aweme)) ?? '');
  await pages(call, '/aweme/v1/web/aweme/listcollection/', {}, 'POST', seen, add(null));
  for (const folder of folders) {
    await pages(call, '/aweme/v1/web/collects/video/list/', { collects_id: folder.id }, 'GET', seen, add(folder.id));
  }
  return { folders, works: [...works.values()] };
}

export async function resolveWork(call: DouyinCall, workId: string): Promise<DouyinResolved> {
  const body = await call('/aweme/v1/web/aweme/detail/', { aweme_id: workId });
  if (signedOut(body)) { throw new Error('signed_out'); }
  const resolved = resolvedWork(body);
  if (resolved === null) {
    throw new Error(object(body)['aweme_detail'] === null ? 'not_found' : 'layout_changed');
  }
  return resolved;
}

export interface DouyinReader {
  list(sinceIds: readonly string[], full?: boolean): Promise<DouyinListResult>;
  resolve(workId: string): Promise<DouyinResolved>;
}

/** 装到 window 上给原生层调。 */
export function installDouyinReader(win: Window & typeof globalThis): DouyinReader {
  const call = pageCall(win);
  return { list: (sinceIds, full) => listFavorites(call, sinceIds, full),
    resolve: (workId) => resolveWork(call, workId) };
}
