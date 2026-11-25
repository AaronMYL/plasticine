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
import { errorCategory, safeLog } from '../util/index.ts';
import { decodeDataUrl, sniffImage } from '../cloud-tools/index.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type AppDeps, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, type AfterCommit } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

const ICON_CACHE = 'private, max-age=86400';
const OLD_BOOKMARKS_GROUP = { id: 'wtg-bookmarks', name: '书签' };

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

function keepAsBookmarks(deps: AppDeps, tabs: readonly WebTab[], afterCommit: AfterCommit): void {
  for (const entry of tabs) {
    try {
      deps.daily.bookmarks.add({ kind: 'web', title: entry.title.trim() === '' ? entry.url : entry.title,
        target: entry.url }, 'manual', afterCommit);
    } catch (error) {
      if (!(error instanceof DailyError)) {
        throw error;
      }
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

export async function getFavicon(context: RequestContext): Promise<HandlerResult> {
  requireAuth(context);
  const query = checkInput(FaviconQuerySchema, queryObject(context.url.searchParams), '网站');
  const icon = await context.deps.toolGroups.favicons.icon(query.host);
  if (icon.status === 'none') {
    throw new ApiError(404, 'not_found', '这个网站没有图标。', { next: '界面照旧画首字母。' });
  }
  context.res.writeHead(200, {
    'content-type': icon.mime,
    'content-length': icon.data.length,
    'cache-control': ICON_CACHE,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  context.res.end(icon.data);
  return 'streamed';
}

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
    context.deps.toolGroups.favicons.remember(host, { mime, data });
    const response: PutFaviconResponse = { host };
    return { status: 200, body: response };
  });
}
