// 信息流页的界面状态：哪几条展开着（2026-11-04 起「为什么推给你」进卡片头的 ⓘ，不再就地展开，只剩收走时清掉）、
// 加链接的表单开没开、要不要连不感兴趣的一起看、看哪一路（第二栏：全部 · 来源 · 收藏）、加来源和抖音收藏两个浮层开没开。
// 放在 state/：切页回来照旧。点了「不感兴趣」那一条从列表里收走时，它的展开状态一起清掉（审查 M2 P1：成功后状态没清）。
// 这次在信息流页上刚点了「不感兴趣」的几条（dismissedIds，11-04）：就地收成可撤销的占位，离开这一页、换分段就清掉。

import type { FeedNavSource, FeedPlace } from '../api/shared.ts';
import type { FeedListQuery } from '../api/types.ts';
import { Store } from './store.ts';

/**
 * 看哪一路（第 7 批第 10 条第二栏；第13批按种类分）：全部 · 收藏 · 一种来源（兴趣、X、小红书、抖音收藏、Reddit、博客）·
 * 同一种里的一个版块或博客（`source:<来源 id>`）· X、小红书在哪一处看到的（`place:<种类>:<哪一处>`）。
 */
export type FeedKind = NonNullable<FeedListQuery['kind']>;
export type FeedSegment = 'all' | FeedKind | 'saved' | `source:${string}` | `place:${'x' | 'xhs'}:${FeedPlace}`;

const SOURCE_PREFIX = 'source:';
const PLACE_PREFIX = 'place:';

/** 看一个来源的分段。 */
export function sourceSegment(sourceId: string): FeedSegment {
  return `${SOURCE_PREFIX}${sourceId}`;
}

/** 看 X / 小红书在某一处看到的。 */
export function placeSegment(kind: 'x' | 'xhs', place: FeedPlace): FeedSegment {
  return `${PLACE_PREFIX}${kind}:${place}`;
}

export interface FeedUiState {
  expandedIds: ReadonlySet<string>;
  adding: boolean;
  includeHidden: boolean;
  /** 只看信息流收藏（2026-11-04：收藏归信息流，和书签分开；第 3 批起是页头分段的「收藏」）。 */
  savedOnly: boolean;
  /** 只看哪一路（第 3 批页头分段 X · 订阅 · 新闻）；null = 全部。和 savedOnly 不同时有值。 */
  kind: FeedKind | null;
  /** 只看这一个来源（第 7 批第 10 条：一个订阅 / Reddit 版块）。和 kind、savedOnly 不同时有值。 */
  sourceId: string | null;
  /** 第13批：X、小红书只看在这一处看到的（kind 是 x 或 xhs）。 */
  place: FeedPlace | null;
  commentIds: ReadonlySet<string>;
  /** 这次刚点了「不感兴趣」、还能就地撤销的几条。 */
  dismissedIds: ReadonlySet<string>;
  /** 「加来源」浮层开着（第二栏顶上的 + 开它）。 */
  sourcesOpen: boolean;
  /** 抖音收藏的勾选清单开着（第二栏里再点一下「抖音收藏」、来源管理里开它）。 */
  douyinOpen: boolean;
  /** 开着「设置…」的那个来源（第 7 批第 10 条：第二栏一行的 ⋯ 里开）；没开是 null。 */
  settingsSource: FeedNavSource | null;
  /** 「加来源」对话框开在哪一种上。 */
  addKind: FeedAddKind;
}

/** 「加来源」顶上的六种（第 7 批第 10 条；第13批加小红书）。 */
export const FEED_ADD_KINDS = ['url', 'reddit', 'interest', 'x', 'xhs', 'douyin'] as const;
export type FeedAddKind = (typeof FEED_ADD_KINDS)[number];

/** 界面状态 → 看的是哪一路。 */
export function segmentOf(state: Pick<FeedUiState, 'savedOnly' | 'kind' | 'sourceId' | 'place'>): FeedSegment {
  if (state.savedOnly) {
    return 'saved';
  }
  if (state.sourceId !== null) return sourceSegment(state.sourceId);
  if (state.place !== null && (state.kind === 'x' || state.kind === 'xhs')) {
    return placeSegment(state.kind, state.place);
  }
  return state.kind ?? 'all';
}

/** 分段 → 界面状态里的那几项。 */
export function parseSegment(segment: FeedSegment): Pick<FeedUiState, 'savedOnly' | 'kind' | 'sourceId' | 'place'> {
  if (segment === 'saved') return { savedOnly: true, kind: null, sourceId: null, place: null };
  if (segment === 'all') return { savedOnly: false, kind: null, sourceId: null, place: null };
  if (segment.startsWith(SOURCE_PREFIX)) {
    return { savedOnly: false, kind: null, sourceId: segment.slice(SOURCE_PREFIX.length), place: null };
  }
  if (segment.startsWith(PLACE_PREFIX)) {
    const [kind, place] = segment.slice(PLACE_PREFIX.length).split(':') as ['x' | 'xhs', FeedPlace];
    return { savedOnly: false, kind, sourceId: null, place };
  }
  return { savedOnly: false, kind: segment as FeedKind, sourceId: null, place: null };
}

export class FeedUi {
  readonly store = new Store<FeedUiState>({ expandedIds: new Set(), adding: false, includeHidden: false,
    savedOnly: false, kind: null, sourceId: null, place: null, commentIds: new Set(), dismissedIds: new Set(),
    sourcesOpen: false, douyinOpen: false, settingsSource: null, addKind: 'url' });

  setSettingsSource(settingsSource: FeedNavSource | null): void {
    this.store.set((state) => (state.settingsSource === settingsSource ? state : { ...state, settingsSource }));
  }

  /** 开「加来源」，停在哪一种上（不给就停在上次那种）。 */
  openAdd(addKind?: FeedAddKind): void {
    this.store.set((state) => ({ ...state, sourcesOpen: true, addKind: addKind ?? state.addKind }));
  }

  setAddKind(addKind: FeedAddKind): void {
    this.store.set((state) => (state.addKind === addKind ? state : { ...state, addKind }));
  }

  setSourcesOpen(sourcesOpen: boolean): void {
    this.store.set((state) => (state.sourcesOpen === sourcesOpen ? state : { ...state, sourcesOpen }));
  }

  setDouyinOpen(douyinOpen: boolean): void {
    this.store.set((state) => (state.douyinOpen === douyinOpen ? state : { ...state, douyinOpen }));
  }

  segment(): FeedSegment {
    return segmentOf(this.store.get());
  }

  setSegment(segment: FeedSegment): void {
    const next = parseSegment(segment);
    this.store.set((state) => (state.savedOnly === next.savedOnly && state.kind === next.kind
      && state.sourceId === next.sourceId && state.place === next.place ? state : { ...state, ...next }));
  }

  toggleComments(id: string): void {
    this.store.set((state) => {
      const commentIds = new Set(state.commentIds);
      if (commentIds.has(id)) { commentIds.delete(id); } else { commentIds.add(id); }
      return { ...state, commentIds };
    });
  }

  markDismissed(id: string): void {
    this.store.set((state) => (state.dismissedIds.has(id) ? state
      : { ...state, dismissedIds: new Set(state.dismissedIds).add(id) }));
  }

  isDismissed(id: string): boolean {
    return this.store.get().dismissedIds.has(id);
  }

  clearDismissed(): void {
    this.store.set((state) => (state.dismissedIds.size === 0 ? state : { ...state, dismissedIds: new Set() }));
  }

  forget(id: string): void {
    this.setExpanded(id, false);
  }

  setAdding(adding: boolean): void {
    this.store.set((state) => (state.adding === adding ? state : { ...state, adding }));
  }

  setIncludeHidden(includeHidden: boolean): void {
    this.store.set((state) => (state.includeHidden === includeHidden ? state : { ...state, includeHidden }));
  }

  setSavedOnly(savedOnly: boolean): void {
    this.store.set((state) => (state.savedOnly === savedOnly ? state : { ...state, savedOnly }));
  }

  private setExpanded(id: string, expanded: boolean): void {
    this.store.set((state) => {
      if (state.expandedIds.has(id) === expanded) {
        return state;
      }
      const expandedIds = new Set(state.expandedIds);
      if (expanded) {
        expandedIds.add(id);
      } else {
        expandedIds.delete(id);
      }
      return { ...state, expandedIds };
    });
  }
}
