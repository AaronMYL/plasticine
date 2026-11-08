// 视频链接认是哪一家（《优化清单》第 9 条）：抖音的作品 ID 在 /video/<id>、/note/<id>、?modal_id=<id> 里；分享出来的
// 短链（v.douyin.com/xxxx）在服务器上跟一次跳转就能拿到（不用登录）。别的网站按清洗后的链接算一个稳定的作品 ID。

import { createHash } from 'node:crypto';

const DOUYIN_HOSTS = /(^|\.)(douyin\.com|iesdouyin\.com)$/;
const SHORT_HOST = 'v.douyin.com';
const SHORT_TIMEOUT_MS = 10_000;

export interface VideoTarget {
  platform: 'douyin' | 'web';
  workId: string;
  url: string;
  kind: 'video' | 'images' | null;
}

/** 链接里的抖音作品；不是抖音作品链接（或是短链）就是 null。 */
export function douyinTarget(raw: string): VideoTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    if (cause instanceof TypeError) {
      return null;
    }
    throw cause;
  }
  if (!DOUYIN_HOSTS.test(url.hostname) || url.hostname === SHORT_HOST) {
    return null;
  }
  const path = /\/(video|note|slides)\/(\d{6,30})/.exec(url.pathname);
  const modal = url.searchParams.get('modal_id');
  const workId = path?.[2] ?? (modal !== null && /^\d{6,30}$/.test(modal) ? modal : null);
  if (workId === null) {
    return null;
  }
  const kind = path?.[1] === 'note' || path?.[1] === 'slides' ? 'images' : null;
  return { platform: 'douyin', workId, kind,
    url: `https://www.douyin.com/${kind === 'images' ? 'note' : 'video'}/${workId}` };
}

export function isShortDouyin(raw: string): boolean {
  try {
    return new URL(raw).hostname === SHORT_HOST;
  } catch (cause) {
    if (cause instanceof TypeError) {
      return false;
    }
    throw cause;
  }
}

/** 别的网站：去掉 # 和常见的追踪参数，散列成作品 ID。 */
export function webTarget(raw: string): VideoTarget {
  const url = new URL(raw);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|spm|from|share|si$|feature$)/.test(key)) {
      url.searchParams.delete(key);
    }
  }
  const clean = url.toString();
  return { platform: 'web', workId: createHash('sha256').update(clean).digest('hex').slice(0, 32), url: clean,
    kind: null };
}

/** 跟一次短链的跳转，拿到作品页链接。 */
export async function expandShortLink(raw: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(raw, { redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(SHORT_TIMEOUT_MS)]) });
  const location = response.headers.get('location');
  if (location === null) {
    throw new Error('这个抖音短链没跳到作品页（可能失效了）。');
  }
  return new URL(location, raw).toString();
}

export async function videoTarget(raw: string, signal: AbortSignal,
  expand: (url: string, signal: AbortSignal) => Promise<string> = expandShortLink): Promise<VideoTarget> {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('只认 http / https 的链接。');
  }
  const expanded = isShortDouyin(url.toString()) ? await expand(url.toString(), signal) : url.toString();
  return douyinTarget(expanded) ?? webTarget(expanded);
}
