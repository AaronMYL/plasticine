// 书签的数据（第 111 条）：在用的书签和项目名单（名字、颜色）。登录后就拉——新标签页、地址栏的 ☆、书签页、
// 标签分组（项目的名字和颜色）都要用；重连（resync）时再拉一份。信息流收藏和书签分开（2026-11-04），信息流的
// 变化不再牵动书签。写操作直接发，回来的那一条换进列表；失败交给调用的地方说一句。

import type { PlasticineApi } from '../../api/client.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import type {
  AddBookmarkRequest,
  BookmarkView,
  ImportBookmarkItem,
  ImportBookmarksResponse,
  ProjectHue,
} from '../../api/shared.ts';
import { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';
import { SnapshotLoader } from '../../state/snapshot-loader.ts';

export interface ProjectChip {
  id: string;
  name: string;
  hue: ProjectHue;
}

export interface BookmarksData {
  status: LoadStatus;
  error: string | null;
  bookmarks: BookmarkView[];
  /** 没完成的项目，常驻的排在最后（和项目列表同一个先后）。 */
  projects: ProjectChip[];
}

const EMPTY: BookmarksData = { status: 'idle', error: null, bookmarks: [], projects: [] };

export type NewBookmark = Omit<AddBookmarkRequest, 'requestId'>;

export class BookmarkStore {
  readonly data = new Store<BookmarksData>(EMPTY);
  private readonly api: PlasticineApi;
  private readonly hub: EventsHub;
  private readonly loader: SnapshotLoader<{ bookmarks: BookmarkView[]; projects: ProjectChip[] }>;
  private stopListening: (() => void) | null = null;

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.api = api;
    this.hub = hub;
    this.loader = new SnapshotLoader({
      fetch: async () => {
        const [list, projects] = await Promise.all([api.bookmarks.list(),
          api.projects.list({ includeDone: false })]);
        return { bookmarks: list.bookmarks, projects: projects.projects
          .map((row) => ({ id: row.id, name: row.name, hue: row.hue })) };
      },
      apply: (value) => this.data.set((data) => ({ ...data, status: 'ready', error: null, ...value })),
      fail: (message) => this.data.set((data) => ({ ...data, status: 'failed', error: message })),
    });
  }

  start(): void {
    if (this.stopListening !== null) {
      return;
    }
    this.loader.restart();
    this.stopListening = this.hub.on((event) => {
      if (event.type === 'resync') {
        this.loader.schedule();
      }
    });
    this.data.set((data) => ({ ...data, status: data.status === 'ready' ? 'ready' : 'loading' }));
    void this.loader.load();
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.loader.stop();
  }

  reload(): Promise<void> {
    return this.loader.load();
  }

  project(id: string | null): ProjectChip | null {
    return id === null ? null : this.data.get().projects.find((project) => project.id === id) ?? null;
  }

  /** 这个网址 / 地址的书签（有的话）。 */
  find(kind: 'web' | 'page', target: string): BookmarkView | null {
    return this.data.get().bookmarks.find((bookmark) => bookmark.kind === kind && bookmark.target === target) ?? null;
  }

  async add(input: NewBookmark): Promise<BookmarkView> {
    const bookmark = await this.api.bookmarks.add({ requestId: createRequestId(), ...input });
    this.put(bookmark);
    return bookmark;
  }

  async edit(bookmark: BookmarkView, patch: { title?: string; projectId?: string | null }): Promise<BookmarkView> {
    const next = await this.api.bookmarks.edit(bookmark.id, { requestId: createRequestId(),
      version: bookmark.version, ...patch });
    this.put(next);
    return next;
  }

  async remove(bookmark: BookmarkView): Promise<void> {
    await this.api.bookmarks.remove(bookmark.id, { requestId: createRequestId(), version: bookmark.version });
    this.data.set((data) => ({ ...data, bookmarks: data.bookmarks.filter((row) => row.id !== bookmark.id) }));
  }

  async order(ids: readonly string[]): Promise<void> {
    const list = await this.api.bookmarks.order({ requestId: createRequestId(), ids: [...ids] });
    this.data.set((data) => ({ ...data, bookmarks: list.bookmarks }));
  }

  async importItems(items: readonly ImportBookmarkItem[]): Promise<ImportBookmarksResponse> {
    const result = await this.api.bookmarks.importItems({ requestId: createRequestId(), items: [...items] });
    this.data.set((data) => ({ ...data, bookmarks: result.bookmarks }));
    return result;
  }

  private put(bookmark: BookmarkView): void {
    this.data.set((data) => {
      const known = data.bookmarks.some((row) => row.id === bookmark.id);
      const bookmarks = known ? data.bookmarks.map((row) => (row.id === bookmark.id ? bookmark : row))
        : [...data.bookmarks, bookmark];
      return { ...data, bookmarks };
    });
  }
}
