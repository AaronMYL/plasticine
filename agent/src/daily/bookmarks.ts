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

export type BookmarkState = Pick<StateService, 'bookmarks' | 'projects' | 'transaction'>;

export interface BookmarkDeskOptions {
  state: BookmarkState;
  now: () => Date;
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

function candidate(bookmark: Bookmark): SuggestionCandidate {
  return { id: bookmark.id, kind: bookmark.kind, target: bookmark.target, title: bookmark.title,
    projectId: bookmark.projectId, snapshot: bookmark.snapshot };
}

export function checkBookmarkUrl(raw: string, field = 'target'): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DailyError('invalid_input', '网址不完整；请用 https:// 或 http:// 开头的地址。', field);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new DailyError('invalid_input', '网页书签只收 http / https 地址。', field);
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

  remove(id: string, version: number): Bookmark {
    this.#requireLive(id);
    return this.#state.bookmarks.update(id, version, { deletedAt: this.#now().toISOString() });
  }

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

  importItems(items: readonly { title: string; url: string; projectId: string | null }[], after: AfterCommit):
    { added: number; skipped: number } {
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      let url: string;
      try {
        url = checkBookmarkUrl(item.url, 'items');
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
        target: tab.kind === 'web' ? checkBookmarkUrl(tab.target, 'tabs') : pageTarget(tab.target, 'tabs') }));
      if (tabs.length === 0) {
        throw new DailyError('invalid_input', '保存的分组里至少要有一页。', 'tabs');
      }
      return { ...base, kind: 'group', target: null, tabs };
    }
    if (input.target === undefined) {
      throw new DailyError('invalid_input', '书签要有网址或页面地址。', 'target');
    }
    const target = input.kind === 'web' ? checkBookmarkUrl(input.target) : pageTarget(input.target);
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
