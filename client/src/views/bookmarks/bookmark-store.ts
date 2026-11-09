// 书签的数据（第 111 条）：在用的书签和项目名单（名字、颜色）。登录后就拉——网页栏的「书签」一节、地址框里的书签
// 按钮、⌘K、项目的名字和颜色都要用；重连（resync）、别处改了书签（bookmarks.changed，第 8 批第 1 条：各设备同一份）
// 时再拉一份。信息流收藏和书签分开（2026-11-04），信息流的变化不再牵动书签。写操作直接发，回来的那一条换进列表
// （按 position 排）；失败交给调用的地方说一句。

import type { PlasticineApi } from '../../api/client.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import {
  bookmarkKey,
  type AddBookmarkRequest,
  type BookmarkView,
  type ImportBookmarkItem,
  type ImportBookmarksResponse,
  type ProjectHue,
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
  /**
   * 从地址框加的：加的那个网址 → 书签 id。服务端会去掉网址里像口令的参数，存下的和标签的网址对不上时，地址框靠它
   * 认出「这一页已经收藏了」（只在这次打开里记）。
   */
  private readonly aliases = new Map<string, string>();

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
      if (event.type === 'resync' || event.type === 'bookmarks.changed') {
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

  /** 这个网址的网页书签（同一个网页按 bookmarkKey 比）；没有是 null。 */
  findWeb(url: string): BookmarkView | null {
    const key = bookmarkKey('web', url);
    const bookmarks = this.data.get().bookmarks;
    const direct = bookmarks.find((bookmark) => bookmark.kind === 'web' && bookmarkKey('web', bookmark.target) === key);
    if (direct !== undefined) {
      return direct;
    }
    const alias = key === null ? undefined : this.aliases.get(key);
    return alias === undefined ? null : bookmarks.find((bookmark) => bookmark.id === alias) ?? null;
  }

  async add(input: NewBookmark): Promise<BookmarkView> {
    const bookmark = await this.api.bookmarks.add({ requestId: createRequestId(), ...input });
    this.put(bookmark);
    return bookmark;
  }

  /** 收藏这个网页（地址框里的书签按钮）。 */
  async addWeb(url: string, title: string): Promise<BookmarkView> {
    const bookmark = await this.add({ kind: 'web', title: title.trim() === '' ? url : title, target: url });
    const key = bookmarkKey('web', url);
    if (key !== null) {
      this.aliases.set(key, bookmark.id);
    }
    return bookmark;
  }

  async edit(bookmark: BookmarkView, patch: { title?: string; projectId?: string | null }): Promise<BookmarkView> {
    const next = await this.api.bookmarks.edit(bookmark.id, { requestId: createRequestId(),
      version: bookmark.version, ...patch });
    this.put(next);
    return next;
  }

  /** 移除；回的是移除之后的那一版（撤销要带它的 version）。 */
  async remove(bookmark: BookmarkView): Promise<BookmarkView> {
    const removed = await this.api.bookmarks.remove(bookmark.id, { requestId: createRequestId(),
      version: bookmark.version });
    this.data.set((data) => ({ ...data, bookmarks: data.bookmarks.filter((row) => row.id !== bookmark.id) }));
    return removed;
  }

  /**
   * 撤销移除：先放回原处（removed 是移除回来的那一版，位置没变），再按服务端回的换上；服务端回的是同一个网址后来又加的
   * 那一条时，放回去的拿掉。没成就拿掉、交给调用的地方说一句。
   */
  async restore(removed: BookmarkView): Promise<BookmarkView> {
    this.put(removed);
    try {
      const restored = await this.api.bookmarks.restore(removed.id, { requestId: createRequestId(),
        version: removed.version });
      if (restored.id !== removed.id) {
        this.drop(removed.id);
      }
      this.put(restored);
      return restored;
    } catch (cause) {
      this.drop(removed.id);
      throw cause;
    }
  }

  /** 排序：先按新的先后画（拖动松手就到位），再按服务端回的；没成就重读一份、交给调用的地方说一句。 */
  async order(ids: readonly string[]): Promise<void> {
    const rank = new Map(ids.map((id, index) => [id, index]));
    this.data.set((data) => ({ ...data, bookmarks: [...data.bookmarks]
      .sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length)) }));
    try {
      const list = await this.api.bookmarks.order({ requestId: createRequestId(), ids: [...ids] });
      this.data.set((data) => ({ ...data, bookmarks: list.bookmarks }));
    } catch (cause) {
      this.loader.schedule();
      throw cause;
    }
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
        : [...data.bookmarks, bookmark].sort((a, b) => a.position - b.position);
      return { ...data, bookmarks };
    });
  }

  private drop(id: string): void {
    this.data.set((data) => ({ ...data, bookmarks: data.bookmarks.filter((row) => row.id !== id) }));
  }
}
