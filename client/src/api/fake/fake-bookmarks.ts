// 假的书签（第 110 条）：和真服务端（agent/src/app/bookmarks.ts、daily/bookmarks.ts）同一套规矩——同一个网址 /
// 地址只留一条、网页只收 http(s)、页面要 #/ 地址、移除只记时间、没归项目的按 shared/bookmarks.ts 的推法推一个项目。
// 信息流收藏和书签分开（2026-11-04），这里不跟信息流同步。写操作按 requestId 幂等，过时了回 409（ConflictError）；
// 写成了发 bookmarks.changed（第 8 批第 1 条，和真服务端一样）。

import { bookmarkKey, suggestProject, type SuggestionCandidate } from '../../../../agent/shared/bookmarks.ts';
import type { BookmarksApi } from '../bookmarks-client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import type {
  AddBookmarkRequest,
  BookmarkListResponse,
  BookmarkTab,
  BookmarkView,
  EditBookmarkRequest,
  ImportBookmarksRequest,
  ImportBookmarksResponse,
  OrderBookmarksRequest,
  RemoveBookmarkRequest,
  RestoreBookmarkRequest,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

const STALE_NEXT = '看 current 里的最新版，确认后用最新的 version 再来。';

interface Stored {
  view: Omit<BookmarkView, 'suggestedProjectId'>;
  snapshot: string | null;
  deletedAt: string | null;
}

export interface FakeBookmarksDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  now: () => Date;
  /** 写成了发 bookmarks.changed；不给（单测直接 new）就不发。 */
  bus?: FakeEventBus;
  /** 推项目要看的项目名单。 */
  projects: () => { id: string; name: string }[];
}

export interface BookmarkSeed {
  id?: string;
  kind: BookmarkView['kind'];
  title: string;
  target?: string;
  projectId?: string | null;
  tabs?: BookmarkTab[];
  snapshot?: string;
  origin?: BookmarkView['origin'];
}

function invalid(message: string, field: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, message, field });
}

function cleanWebUrl(raw: string, field: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // 和真服务端一样，不把原文带进错误。
    throw invalid('网址不完整；请用 https:// 或 http:// 开头的地址。', field);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw invalid('网页书签只收 http / https 地址。', field);
  }
  url.username = '';
  url.password = '';
  return url.toString();
}

export class FakeBookmarks implements BookmarksApi {
  private readonly deps: FakeBookmarksDeps;
  private readonly rows = new Map<string, Stored>();
  private sequence = 0;

  constructor(deps: FakeBookmarksDeps) {
    this.deps = deps;
  }

  async list(): Promise<BookmarkListResponse> {
    this.deps.session.require();
    return { bookmarks: this.views() };
  }

  async add(input: AddBookmarkRequest): Promise<BookmarkView> {
    this.deps.session.require();
    return this.deps.receipts.run('bookmark', input.requestId, 'POST /v2/bookmarks', () => {
      const { requestId: _requestId, snapshot, ...rest } = input;
      const before = this.rows.size;
      const stored = this.insert({ ...rest, ...(snapshot === undefined ? {} : { snapshot: snapshot.text }) });
      if (this.rows.size > before) {
        this.changed();
      }
      return this.view(stored);
    });
  }

  async edit(id: string, input: EditBookmarkRequest): Promise<BookmarkView> {
    this.deps.session.require();
    return this.deps.receipts.run('bookmark', input.requestId, `PUT /v2/bookmarks/${id}`, () => {
      const stored = this.writable(id, input.version);
      this.requireProject(input.projectId);
      stored.view = {
        ...stored.view,
        ...(input.title === undefined ? {} : { title: input.title.trim() || stored.view.title }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        updatedAt: this.deps.now().toISOString(),
        version: stored.view.version + 1,
      };
      this.changed();
      return this.view(stored);
    });
  }

  async remove(id: string, input: RemoveBookmarkRequest): Promise<BookmarkView> {
    this.deps.session.require();
    return this.deps.receipts.run('bookmark', input.requestId, `POST /v2/bookmarks/${id}/remove`, () => {
      const stored = this.writable(id, input.version);
      this.drop(stored);
      this.changed();
      return this.view(stored);
    });
  }

  async restore(id: string, input: RestoreBookmarkRequest): Promise<BookmarkView> {
    this.deps.session.require();
    return this.deps.receipts.run('bookmark', input.requestId, `POST /v2/bookmarks/${id}/restore`, () => {
      const stored = this.rows.get(id);
      if (stored === undefined) {
        throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '没有这条书签。' });
      }
      if (stored.deletedAt === null) {
        return this.view(stored);
      }
      const key = bookmarkKey(stored.view.kind, stored.view.target);
      const twin = key === null ? undefined
        : this.live().find((row) => bookmarkKey(row.view.kind, row.view.target) === key);
      if (twin !== undefined) {
        return this.view(twin);
      }
      if (stored.view.version !== input.version) {
        throw new ConflictError(this.view(stored), '这条书签在别处改过了，这次没有改。', STALE_NEXT);
      }
      stored.deletedAt = null;
      stored.view = { ...stored.view, updatedAt: this.deps.now().toISOString(), version: stored.view.version + 1 };
      this.changed();
      return this.view(stored);
    });
  }

  async order(input: OrderBookmarksRequest): Promise<BookmarkListResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('bookmark', input.requestId, 'POST /v2/bookmarks/order', () => {
      const live = this.live();
      const listed = [...new Set(input.ids)].filter((id) => live.some((row) => row.view.id === id));
      const rest = live.map((row) => row.view.id).filter((id) => !listed.includes(id));
      [...listed, ...rest].forEach((id, position) => {
        const stored = this.rows.get(id)!;
        if (stored.view.position !== position) {
          stored.view = { ...stored.view, position, version: stored.view.version + 1 };
        }
      });
      this.changed();
      return { bookmarks: this.views() };
    });
  }

  async importItems(input: ImportBookmarksRequest): Promise<ImportBookmarksResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('bookmark', input.requestId, 'POST /v2/bookmarks/import', () => {
      let added = 0;
      let skipped = 0;
      for (const item of input.items) {
        let target: string;
        try {
          target = cleanWebUrl(item.url, 'items');
        } catch (cause) {
          if (!(cause instanceof ApiError)) {
            throw cause;
          }
          skipped += 1;
          continue;
        }
        const known = this.deps.projects().some((project) => project.id === item.projectId);
        const before = this.rows.size;
        this.insert({ kind: 'web', title: item.title.trim() || target, target,
          projectId: known ? item.projectId : null }, 'import');
        if (this.rows.size > before) {
          added += 1;
        } else {
          skipped += 1;
        }
      }
      if (added > 0) {
        this.changed();
      }
      return { added, skipped, bookmarks: this.views() };
    });
  }

  /** 预置一条（本地开发、截图和测试用）。 */
  seed(seed: BookmarkSeed): BookmarkView {
    const stored = this.insert({ kind: seed.kind, title: seed.title,
      ...(seed.target === undefined ? {} : { target: seed.target }),
      ...(seed.projectId === undefined ? {} : { projectId: seed.projectId }),
      ...(seed.tabs === undefined ? {} : { tabs: seed.tabs }),
      ...(seed.snapshot === undefined ? {} : { snapshot: seed.snapshot }) }, seed.origin ?? 'manual', seed.id);
    return this.view(stored);
  }

  /** 查找用：在用的书签和它们的正文快照。 */
  searchable(): { id: string; title: string; text: string; detail: string; updatedAt: string }[] {
    return this.live().map((row) => ({ id: row.view.id, title: row.view.title, text: row.snapshot ?? '',
      detail: row.view.kind === 'web' ? row.view.target ?? '' : '', updatedAt: row.view.updatedAt }));
  }

  private insert(input: Omit<BookmarkSeed, 'origin' | 'id'>, origin: BookmarkView['origin'] = 'manual',
    id?: string): Stored {
    this.requireProject(input.projectId);
    const title = input.title.trim();
    if (title === '') {
      throw invalid('书签要有个名字。', 'title');
    }
    let target: string | null = null;
    let tabs: BookmarkTab[] = [];
    if (input.kind === 'group') {
      tabs = input.tabs ?? [];
      if (tabs.length === 0) {
        throw invalid('保存的分组里至少要有一页。', 'tabs');
      }
    } else if (input.target === undefined) {
      throw invalid('书签要有网址或页面地址。', 'target');
    } else if (input.kind === 'web') {
      target = cleanWebUrl(input.target, 'target');
    } else if (input.target.startsWith('#/')) {
      target = input.target;
    } else {
      throw invalid('Plasticine 自己的页面要用 #/ 开头的地址。', 'target');
    }
    const key = bookmarkKey(input.kind, target);
    const existing = key === null ? undefined
      : this.live().find((row) => bookmarkKey(row.view.kind, row.view.target) === key);
    if (existing !== undefined) {
      return existing;
    }
    this.sequence += 1;
    const at = this.deps.now().toISOString();
    const stored: Stored = { snapshot: input.snapshot ?? null, deletedAt: null, view: {
      id: id ?? `bm_${this.sequence}`, kind: input.kind, title, target, projectId: input.projectId ?? null, tabs,
      origin, feedItemId: null, snapshotChars: Array.from(input.snapshot ?? '').length,
      position: this.nextPosition(), createdAt: at, updatedAt: at, version: 1 } };
    this.rows.set(stored.view.id, stored);
    return stored;
  }

  private changed(): void {
    this.deps.bus?.emit({ type: 'bookmarks.changed' });
  }

  private drop(stored: Stored): void {
    const at = this.deps.now().toISOString();
    stored.deletedAt = at;
    stored.view = { ...stored.view, updatedAt: at, version: stored.view.version + 1 };
  }

  private live(): Stored[] {
    return [...this.rows.values()].filter((row) => row.deletedAt === null)
      .sort((a, b) => a.view.position - b.view.position || a.view.createdAt.localeCompare(b.view.createdAt));
  }

  private nextPosition(): number {
    return [...this.rows.values()].reduce((top, row) => Math.max(top, row.view.position + 1), 0);
  }

  private views(): BookmarkView[] {
    return this.live().map((row) => this.view(row));
  }

  private view(stored: Stored): BookmarkView {
    const candidate = (row: Stored): SuggestionCandidate => ({ id: row.view.id, kind: row.view.kind,
      target: row.view.target, title: row.view.title, projectId: row.view.projectId, snapshot: row.snapshot });
    const suggested = stored.deletedAt !== null ? null
      : suggestProject(candidate(stored), this.live().map(candidate), this.deps.projects());
    return structuredClone({ ...stored.view, suggestedProjectId: suggested });
  }

  private writable(id: string, version: number): Stored {
    const stored = this.rows.get(id);
    if (stored === undefined || stored.deletedAt !== null) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '没有这条书签（可能已经移除了）。' });
    }
    if (stored.view.version !== version) {
      throw new ConflictError(this.view(stored), '这条书签在别处改过了，这次没有改。', STALE_NEXT);
    }
    return stored;
  }

  private requireProject(projectId: string | null | undefined): void {
    if (projectId != null && !this.deps.projects().some((project) => project.id === projectId)) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '没有这个项目，书签没有改。' });
    }
  }
}
