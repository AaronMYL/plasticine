// /v2/web-tabs：竖排网页标签的摆放（11-08 起存在本体里，每台设备同一份）；/v2/favicon：网站图标（本体代取）。
// 写是整份换：带上画出来时的 version，过时就 409 带现在那一份；写成了告诉别的设备（web_tabs_changed）。
// 某台设备上还没搬上来的旧存档走 merge（同一个网址已经有了的跳过）。旧存档里的「书签」一组（11-07 各设备自己搬的、
// 0109 搬的）不再成组：0121 起书签和标签分开，组里的网页加成书签（同一个网址已经有的不重复）。

import {
  FaviconQuerySchema,
  PutFaviconRequestSchema,
  WEB_TAB_ICON_MAX_BYTES,
  faviconHost,
  type PutFaviconResponse,
  MergeWebTabsRequestSchema,
  PutWebTabsRequestSchema,
  type PutWebTabsResponse,
  type WebTab,
  type WebTabsLayout,
  type WebTabsResponse,
} from '../../shared/api/index.ts';
import { DailyError } from '../daily/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { decodeDataUrl, sniffImage } from '../cloud-tools/favicon-fetch.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type AppDeps, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, type AfterCommit } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

/** 浏览器缓存一天：图标不常变，库里的缓存另有过期。 */
const ICON_CACHE = 'private, max-age=86400';
/** 旧存档里的「书签」一组：0109 搬的 id，11-07 各设备自己搬的按名字认。 */
const OLD_BOOKMARKS_GROUP = { id: 'wtg-bookmarks', name: '书签' };

/** 旧存档里「书签」那一组的标签拿出来（要加成书签的），剩下的照常合并。 */
function bookmarkGroupApart(layout: WebTabsLayout): { rest: WebTabsLayout; bookmarked: WebTab[] } {
  const old = layout.groups.filter((group) => group.id === OLD_BOOKMARKS_GROUP.id
    || group.name === OLD_BOOKMARKS_GROUP.name);
  if (old.length === 0) {
    return { rest: layout, bookmarked: [] };
  }
  const ids = new Set(old.flatMap((group) => group.tabIds));
  return {
    rest: { ...layout, groups: layout.groups.filter((group) => !old.includes(group)),
      tabs: layout.tabs.filter((entry) => !ids.has(entry.id)) },
    bookmarked: layout.tabs.filter((entry) => ids.has(entry.id)),
  };
}

/** 加成书签；网址收不了（不是 http(s)）的跳过，那一页不进书签也不再成标签。 */
function keepAsBookmarks(deps: AppDeps, tabs: readonly WebTab[], afterCommit: AfterCommit): void {
  for (const entry of tabs) {
    try {
      deps.daily.bookmarks.add({ kind: 'web', title: entry.title.trim() === '' ? entry.url : entry.title,
        target: entry.url }, 'manual', afterCommit);
    } catch (error) {
      if (!(error instanceof DailyError)) {
        throw error;
      }
      // 网址不进日志：里面可能带口令。
      safeLog('warn', 'legacy_bookmark_skipped', { category: errorCategory(error) });
    }
  }
}

function announce(deps: AppDeps, afterCommit: AfterCommit, before: number, after: number): void {
  if (after !== before) {
    afterCommit(() => deps.hub.publish({ type: 'web_tabs_changed', version: after }));
  }
}

/** GET /v2/web-tabs */
export function getWebTabs(context: RequestContext): Reply {
  requireAuth(context);
  const body: WebTabsResponse = context.deps.state.webTabs.read();
  return { status: 200, body };
}

/** PUT /v2/web-tabs */
export async function putWebTabs(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(PutWebTabsRequestSchema, await readJsonBody(context.req), '竖排标签');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    let saved;
    try {
      saved = deps.state.webTabs.write(body.layout, body.baseVersion);
    } catch (error) {
      if (!(error instanceof StateError) || error.code !== 'version_conflict') {
        throw error;
      }
      const current: WebTabsResponse = deps.state.webTabs.read();
      throw new ApiError(409, 'version_conflict', '竖排标签在别的设备上改过了，这次没有存。', {
        currentVersion: current.version,
        next: '在 current 那一份上把这几步重做一遍，带它的 version 再送。',
        extra: { current },
      });
    }
    announce(deps, afterCommit, body.baseVersion, saved.version);
    const response: PutWebTabsResponse = { version: saved.version };
    return { status: 200, body: response };
  });
}

/** POST /v2/web-tabs/merge */
export async function mergeWebTabs(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(MergeWebTabsRequestSchema, await readJsonBody(context.req), '合并竖排标签');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const before = deps.state.webTabs.read().version;
    const { rest, bookmarked } = bookmarkGroupApart(body.layout);
    keepAsBookmarks(deps, bookmarked, afterCommit);
    const saved: WebTabsResponse = deps.state.webTabs.merge(rest);
    announce(deps, afterCommit, before, saved.version);
    return { status: 200, body: saved };
  });
}

/** GET /v2/favicon?host=：回图标字节；这个网站没有图标是 404（界面画首字母）。 */
export async function getFavicon(context: RequestContext): Promise<HandlerResult> {
  requireAuth(context);
  const query = checkInput(FaviconQuerySchema, queryObject(context.url.searchParams), '网站');
  const icon = await context.deps.m5b.favicons.icon(query.host);
  if (icon.status === 'none') {
    throw new ApiError(404, 'not_found', '这个网站没有图标。', { next: '界面照旧画首字母。' });
  }
  context.res.writeHead(200, {
    'content-type': icon.mime,
    'content-length': icon.data.length,
    'cache-control': ICON_CACHE,
    'x-content-type-options': 'nosniff',
    // 直接打开这个地址也只是一张图：SVG 里的脚本不跑、不带来源。
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  context.res.end(icon.data);
  return 'streamed';
}

/** PUT /v2/favicon：桌面壳报来的网站图标按 pageUrl 的域名存进缓存（别的设备也用上）。 */
export async function putFavicon(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(PutFaviconRequestSchema, await readJsonBody(context.req), '网站图标');
  const host = faviconHost(body.pageUrl);
  const data = decodeDataUrl(body.icon);
  const mime = data === null || data.length > WEB_TAB_ICON_MAX_BYTES ? null : sniffImage(data);
  if (host === null || data === null || mime === null) {
    throw new ApiError(400, 'invalid_request', '这不是一个网站的图标，没有存。', { field: host === null ? 'pageUrl' : 'icon',
      next: '只收 http(s) 网页的图片（PNG、ICO、GIF、JPEG、WebP、SVG），64 KB 以内。' });
  }
  return idempotent(context, body.requestId, () => {
    context.deps.m5b.favicons.remember(host, { mime, data });
    const response: PutFaviconResponse = { host };
    return { status: 200, body: response };
  });
}
