// 书签（2026-11-03 用户定，第 110 条）：加（同一个网址 / 地址只留一条）、改名和移项目、移除（只记时间）、撤销移除、
// 排序、导入浏览器导出的书签。没归项目的书签由这里推一个项目（shared/bookmarks.ts 的推法）。
// 2026-11-04 用户定：信息流收藏归信息流、网页收藏归书签，两边分开——这里不再跟信息流收藏同步；origin = feed、
// 带 feedItemId 的旧书签（迁移 0045 搬来的，0051 已从书签移走）照样读得出来。
// 数据只经 state/ 写；加了书签记一条触发由 app/ 注入（onAdded），这里不碰进门。

import {
  BOOKMARK_SNAPSHOT_MAX_CHARS,
  BOOKMARK_TITLE_MAX,
  type Bookmark,
  type BookmarkKind,
  type BookmarkOrigin,
  type BookmarkTab,
} from '../../shared/state.ts';
import { bookmarkKey, suggestProject, type SuggestionCandidate } from '../../shared/bookmarks.ts';
import type { AfterCommit } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { DailyError } from './errors.ts';
import { cleanUrlQuery } from './urls.ts';

export type BookmarkState = Pick<StateService, 'bookmarks' | 'projects' | 'transaction'>;

export interface BookmarkDeskOptions {
  state: BookmarkState;
  now: () => Date;
  /** 新加了一条（提交之后）：记进来源。 */
  onAdded?: (bookmark: Bookmark) => void;
}

export interface NewBookmark {
  kind: BookmarkKind;
  title: string;
  target?: string | undefined;
  projectId?: string | null | undefined;
  tabs?: readonly BookmarkTab[] | undefined;
  snapshot?: { text: string; totalChars: number } | undefined;
}

/** 推法要看的那几样：没删的书签和全部项目（只要名字）。 */
function candidate(bookmark: Bookmark): SuggestionCandidate {
  return { id: bookmark.id, kind: bookmark.kind, target: bookmark.target, title: bookmark.title,
    projectId: bookmark.projectId, snapshot: bookmark.snapshot };
}

/** 网页书签的网址：只收 http(s)，去掉账号密码和像口令的参数；# 后面的留着（单页应用靠它定位）。 */
export function cleanBookmarkUrl(raw: string, field = 'target'): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // 不把原文带进错误：坏网址里也可能夹着口令（同 urls.ts 的 cleanUrl）。
    throw new DailyError('invalid_input', '网址不完整；请用 https:// 或 http:// 开头的地址。', field);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new DailyError('invalid_input', '网页书签只收 http / https 地址。', field);
  }
  url.username = '';
  url.password = '';
  const query = url.search.slice(1);
  const cleaned = cleanUrlQuery(query);
  if (cleaned !== query) {
    url.search = cleaned;
  }
  return url.toString();
}

function clipChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

function pageTarget(raw: string, field = 'target'): string {
  if (!raw.startsWith('#/')) {
    throw new DailyError('invalid_input', 'Plasticine 自己的页面要用 #/ 开头的地址。', field);
  }
  return raw;
}

export class BookmarkDesk {
  readonly #state: BookmarkState;
  readonly #now: () => Date;
  readonly #onAdded: (bookmark: Bookmark) => void;

  constructor(options: BookmarkDeskOptions) {
    this.#state = options.state;
    this.#now = options.now;
    this.#onAdded = options.onAdded ?? (() => undefined);
  }

  live(): Bookmark[] {
    return this.#state.bookmarks.live();
  }

  /** 每条没归项目的书签推哪个项目（✦）；归了项目的、拿不准的不在里面。 */
  suggestions(live: readonly Bookmark[] = this.live()): Map<string, string> {
    const projects = this.#state.projects.all().filter((project) => project.lifecycle !== 'done')
      .map((project) => ({ id: project.id, name: project.name }));
    const others = live.map(candidate);
    const result = new Map<string, string>();
    for (const bookmark of live) {
      const projectId = suggestProject(candidate(bookmark), others, projects);
      if (projectId !== null) {
        result.set(bookmark.id, projectId);
      }
    }
    return result;
  }

  /** 加一条；同一个网址 / 地址已经有了就回那一条（created = false）。 */
  add(input: NewBookmark, origin: BookmarkOrigin, after: AfterCommit, extra: { feedItemId?: string } = {}):
    { bookmark: Bookmark; created: boolean } {
    const prepared = this.#prepare(input);
    const key = bookmarkKey(prepared.kind, prepared.target);
    const existing = key === null ? undefined
      : this.live().find((bookmark) => bookmarkKey(bookmark.kind, bookmark.target) === key);
    if (existing !== undefined) {
      return { bookmark: existing, created: false };
    }
    const bookmark = this.#state.bookmarks.create({
      ...prepared,
      origin,
      feedItemId: extra.feedItemId ?? null,
      position: this.#state.bookmarks.nextPosition(),
    });
    after(() => this.#onAdded(bookmark));
    return { bookmark, created: true };
  }

  edit(id: string, version: number, patch: { title?: string | undefined; projectId?: string | null | undefined }):
    Bookmark {
    const current = this.#requireLive(id);
    if (patch.projectId !== undefined && patch.projectId !== null) {
      this.#requireProject(patch.projectId);
    }
    const title = patch.title === undefined ? {} : { title: clipChars(patch.title.trim() || current.title,
      BOOKMARK_TITLE_MAX) };
    const project = patch.projectId === undefined ? {} : { projectId: patch.projectId };
    return this.#state.bookmarks.update(id, version, { ...title, ...project });
  }

  /** 移除：只记时间。不碰信息流收藏（两边分开，2026-11-04）。 */
  remove(id: string, version: number): Bookmark {
    this.#requireLive(id);
    return this.#state.bookmarks.update(id, version, { deletedAt: this.#now().toISOString() });
  }

  /**
   * 撤销移除：回到原来的位置（position 没动过）。同一个网址 / 地址这期间又加了一条，就回那一条（不出两条）。
   * 本来就在用的原样回。version 是移除回来的那一版。
   */
  restore(id: string, version: number): Bookmark {
    const bookmark = this.#state.bookmarks.get(id);
    if (bookmark === undefined) {
      throw new DailyError('not_found', '没有这条书签。');
    }
    if (bookmark.deletedAt === null) {
      return bookmark;
    }
    const key = bookmarkKey(bookmark.kind, bookmark.target);
    const twin = key === null ? undefined
      : this.live().find((other) => bookmarkKey(other.kind, other.target) === key);
    return twin ?? this.#state.bookmarks.update(id, version, { deletedAt: null });
  }

  /** 按 ids 的先后重排：列到的依次排在最前，没列到的保持原来的相对顺序排在后面。 */
  order(ids: readonly string[]): Bookmark[] {
    const live = this.live();
    const known = new Map(live.map((bookmark) => [bookmark.id, bookmark]));
    const listed = [...new Set(ids)].filter((id) => known.has(id));
    const rest = live.filter((bookmark) => !listed.includes(bookmark.id)).map((bookmark) => bookmark.id);
    [...listed, ...rest].forEach((id, position) => {
      const bookmark = known.get(id)!;
      if (bookmark.position !== position) {
        this.#state.bookmarks.update(id, bookmark.version, { position });
      }
    });
    return this.live();
  }

  /** 导入：坏网址、已经有的网址跳过（一次里重复的也只留一条）。 */
  importItems(items: readonly { title: string; url: string; projectId: string | null }[], after: AfterCommit):
    { added: number; skipped: number } {
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      let url: string;
      try {
        url = cleanBookmarkUrl(item.url, 'items');
      } catch (error) {
        if (!(error instanceof DailyError)) {
          throw error;
        }
        skipped += 1;
        continue;
      }
      const projectId = item.projectId !== null && this.#state.projects.get(item.projectId) !== undefined
        ? item.projectId : null;
      const title = item.title.trim() === '' ? url : item.title;
      const { created } = this.add({ kind: 'web', title, target: url, projectId }, 'import', after);
      if (created) {
        added += 1;
      } else {
        skipped += 1;
      }
    }
    return { added, skipped };
  }

  #prepare(input: NewBookmark): Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'origin'
    | 'feedItemId' | 'position' | 'deletedAt'> {
    if (input.projectId !== undefined && input.projectId !== null) {
      this.#requireProject(input.projectId);
    }
    const title = clipChars(input.title.trim(), BOOKMARK_TITLE_MAX);
    if (title === '') {
      throw new DailyError('invalid_input', '书签要有个名字。', 'title');
    }
    const snapshot = input.snapshot === undefined || input.snapshot.text.trim() === '' ? null
      : clipChars(input.snapshot.text, BOOKMARK_SNAPSHOT_MAX_CHARS);
    const snapshotChars = snapshot === null ? 0
      : Math.max(input.snapshot?.totalChars ?? 0, Array.from(snapshot).length);
    const base = { title, projectId: input.projectId ?? null, snapshot, snapshotChars };
    if (input.kind === 'group') {
      const tabs = (input.tabs ?? []).map((tab) => ({ ...tab,
        target: tab.kind === 'web' ? cleanBookmarkUrl(tab.target, 'tabs') : pageTarget(tab.target, 'tabs') }));
      if (tabs.length === 0) {
        throw new DailyError('invalid_input', '保存的分组里至少要有一页。', 'tabs');
      }
      return { ...base, kind: 'group', target: null, tabs };
    }
    if (input.target === undefined) {
      throw new DailyError('invalid_input', '书签要有网址或页面地址。', 'target');
    }
    const target = input.kind === 'web' ? cleanBookmarkUrl(input.target) : pageTarget(input.target);
    return { ...base, kind: input.kind, target, tabs: [] };
  }

  #requireLive(id: string): Bookmark {
    const bookmark = this.#state.bookmarks.get(id);
    if (bookmark === undefined || bookmark.deletedAt !== null) {
      throw new DailyError('not_found', '没有这条书签（可能已经移除了）。');
    }
    return bookmark;
  }

  #requireProject(id: string): void {
    if (this.#state.projects.get(id) === undefined) {
      throw new DailyError('not_found', '没有这个项目，书签没有改。', 'projectId');
    }
  }
}
