import {
  AddBookmarkRequestSchema,
  EditBookmarkRequestSchema,
  ImportBookmarksRequestSchema,
  OrderBookmarksRequestSchema,
  RemoveBookmarkRequestSchema,
  RestoreBookmarkRequestSchema,
  type BookmarkListResponse,
  type BookmarkResponse,
  type BookmarkView,
  type ImportBookmarksResponse,
} from '../../shared/api/index.ts';
import type { Bookmark } from '../../shared/state.ts';
import { StateError } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, type AfterCommit } from './idempotency.ts';
import { checkInput } from './validate.ts';

export function bookmarkView(bookmark: Bookmark, suggestions: ReadonlyMap<string, string>): BookmarkView {
  return {
    id: bookmark.id,
    kind: bookmark.kind,
    title: bookmark.title,
    target: bookmark.target,
    projectId: bookmark.projectId,
    tabs: bookmark.tabs,
    origin: bookmark.origin,
    feedItemId: bookmark.feedItemId,
    snapshotChars: bookmark.snapshotChars,
    position: bookmark.position,
    suggestedProjectId: suggestions.get(bookmark.id) ?? null,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
    version: bookmark.version,
  };
}

function views(deps: AppDeps): BookmarkView[] {
  const live = deps.daily.bookmarks.live();
  const suggestions = deps.daily.bookmarks.suggestions(live);
  return live.map((bookmark) => bookmarkView(bookmark, suggestions));
}

function single(deps: AppDeps, bookmark: Bookmark): BookmarkView {
  return views(deps).find((view) => view.id === bookmark.id) ?? bookmarkView(bookmark, new Map());
}

function announce(deps: AppDeps, afterCommit: AfterCommit): void {
  afterCommit(() => deps.hub.publish({ type: 'bookmarks_changed' }));
}

/** A version conflict answered with the bookmark as it is now. */
function withCurrent<T>(deps: AppDeps, id: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (!(error instanceof StateError) || error.code !== 'version_conflict') {
      throw error;
    }
    const current = deps.state.bookmarks.require(id);
    throw new ApiError(409, 'version_conflict', '这条书签在别处改过了，这次没有改。', {
      currentVersion: current.version,
      next: '看 current 里的最新版，确认后用最新的 version 再来。',
      extra: { current: single(deps, current) },
    });
  }
}

/** GET /v2/bookmarks */
export function listBookmarks(context: RequestContext): Reply {
  requireAuth(context);
  const body: BookmarkListResponse = { bookmarks: views(context.deps) };
  return { status: 200, body };
}

/** POST /v2/bookmarks */
export async function addBookmark(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(AddBookmarkRequestSchema, await readJsonBody(context.req), '加书签');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const { requestId: _requestId, ...input } = body;
    const { bookmark, created } = deps.daily.bookmarks.add(input, 'manual', afterCommit);
    if (created) {
      announce(deps, afterCommit);
    }
    const response: BookmarkResponse = { bookmark: single(deps, bookmark) };
    return { status: created ? 201 : 200, body: response };
  });
}

/** PUT /v2/bookmarks/:id */
export async function editBookmark(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(EditBookmarkRequestSchema, await readJsonBody(context.req), '改书签');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const bookmark = withCurrent(deps, id, () => deps.daily.bookmarks.edit(id, body.version,
      { title: body.title, projectId: body.projectId }));
    announce(deps, afterCommit);
    const response: BookmarkResponse = { bookmark: single(deps, bookmark) };
    return { status: 200, body: response };
  });
}

/** POST /v2/bookmarks/:id/remove */
export async function removeBookmark(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(RemoveBookmarkRequestSchema, await readJsonBody(context.req), '移除书签');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const bookmark = withCurrent(deps, id, () => deps.daily.bookmarks.remove(id, body.version));
    announce(deps, afterCommit);
    const response: BookmarkResponse = { bookmark: bookmarkView(bookmark, new Map()) };
    return { status: 200, body: response };
  });
}

/** POST /v2/bookmarks/:id/restore */
export async function restoreBookmark(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(RestoreBookmarkRequestSchema, await readJsonBody(context.req), '撤销移除书签');
  const id = param(context, 'id');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const bookmark = withCurrent(deps, id, () => deps.daily.bookmarks.restore(id, body.version));
    announce(deps, afterCommit);
    const response: BookmarkResponse = { bookmark: single(deps, bookmark) };
    return { status: 200, body: response };
  });
}

/** POST /v2/bookmarks/order */
export async function orderBookmarks(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(OrderBookmarksRequestSchema, await readJsonBody(context.req), '书签排序');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    deps.daily.bookmarks.order(body.ids);
    announce(deps, afterCommit);
    const response: BookmarkListResponse = { bookmarks: views(deps) };
    return { status: 200, body: response };
  });
}

/** POST /v2/bookmarks/import */
export async function importBookmarks(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(ImportBookmarksRequestSchema, await readJsonBody(context.req), '导入书签');
  const { deps } = context;
  return idempotent(context, body.requestId, (afterCommit) => {
    const { added, skipped } = deps.daily.bookmarks.importItems(body.items, afterCommit);
    if (added > 0) {
      announce(deps, afterCommit);
    }
    const response: ImportBookmarksResponse = { added, skipped, bookmarks: views(deps) };
    return { status: 200, body: response };
  });
}
