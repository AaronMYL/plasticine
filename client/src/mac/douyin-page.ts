import type { DouyinFolderView, DouyinListedWork, DouyinResolved } from '../api/shared.ts';

const ORIGIN = 'https://www.douyin.com';
const TITLE_MAX = 1_000;
const CAPTION_MAX = 5_000;
const IMAGES_MAX = 40;
const PAGE_COUNT = 18;
const PAGES_MAX = 1_000;
const FOLDER_PAGE_COUNT = 50;
const FOLDER_PAGES_MAX = 20;
const IMAGE_POST_TYPES = new Set([2, 68, 150]);
const COMMON_PARAMS: Readonly<Record<string, string>> = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1', version_code: '170400',
  version_name: '17.4.0', cookie_enabled: 'true', platform: 'PC', downlink: '10',
};

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

function durationOf(aweme: Json): number | null {
  const ms = Number(object(aweme['video'])['duration'] ?? aweme['duration']);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 100) / 10 : null;
}

function isoOf(seconds: unknown): string | null {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
}

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
    coverUrl: firstUrl(object(aweme['video'])['cover']) ?? firstUrl(object(aweme['video'])['origin_cover'])
      ?? firstUrl(object(array(aweme['images'])[0])),
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

export function signedOut(body: unknown): boolean {
  const code = Number(object(body)['status_code']);
  return code === 8 || code === 2483;
}

export interface DouyinCall {
  (path: string, params: Readonly<Record<string, string>>, method?: 'GET' | 'POST'): Promise<unknown>;
}

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
    if (Number(body['has_more']) !== 1) { return; }
    const nextCursor = String(body['cursor'] ?? body['max_cursor'] ?? '0');
    if (nextCursor === cursor) { throw new Error('layout_changed'); }
    cursor = nextCursor;
  }
  throw new Error('layout_changed');
}

export async function listFavorites(call: DouyinCall, sinceIds: readonly string[], full = false):
  Promise<DouyinListResult> {
  const known = new Set(sinceIds);
  const works = new Map<string, DouyinListedWork>();
  const folders: DouyinFolderView[] = [];
  let folderCursor = '0';
  for (let page = 0; page < FOLDER_PAGES_MAX; page += 1) {
    const body = object(await call('/aweme/v1/web/collects/list/',
      { cursor: folderCursor, count: String(FOLDER_PAGE_COUNT) }));
    if (signedOut(body)) { throw new Error('signed_out'); }
    for (const raw of array(body['collects_list'])) {
      const folder = folderOf(raw);
      if (folder !== null && !folders.some((known) => known.id === folder.id)) { folders.push(folder); }
    }
    const next = String(body['cursor'] ?? '');
    if (Number(body['has_more']) !== 1 || next === '' || next === folderCursor) { break; }
    folderCursor = next;
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

export function installDouyinReader(win: Window & typeof globalThis): DouyinReader {
  const call = pageCall(win);
  return { list: (sinceIds, full) => listFavorites(call, sinceIds, full),
    resolve: (workId) => resolveWork(call, workId) };
}
