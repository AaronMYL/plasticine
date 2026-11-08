// 信息流页的界面状态：哪几条展开着（2026-11-04 起「为什么推给你」进卡片头的 ⓘ，不再就地展开，只剩收走时清掉）、
// 加链接的表单开没开、要不要连不感兴趣的一起看、看哪一路（第二栏：全部 · 来源 · 收藏）、加来源和抖音收藏两个浮层开没开。
// 放在 state/：切页回来照旧。点了「不感兴趣」那一条从列表里收走时，它的展开状态一起清掉（审查 M2 P1：成功后状态没清）。
// 这次在信息流页上刚点了「不感兴趣」的几条（dismissedIds，11-04）：就地收成可撤销的占位，离开这一页、换分段就清掉。

import type { FeedListQuery } from '../api/types.ts';
import { Store } from './store.ts';

/** 第 3 批页头分段：全部 · X · 订阅 · 新闻 · 收藏。 */
export type FeedSegment = 'all' | NonNullable<FeedListQuery['kind']> | 'saved';

export interface FeedUiState {
  expandedIds: ReadonlySet<string>;
  adding: boolean;
  includeHidden: boolean;
  /** 只看信息流收藏（2026-11-04：收藏归信息流，和书签分开；第 3 批起是页头分段的「收藏」）。 */
  savedOnly: boolean;
  /** 只看哪一路（第 3 批页头分段 X · 订阅 · 新闻）；null = 全部。和 savedOnly 不同时有值。 */
  kind: NonNullable<FeedListQuery['kind']> | null;
  commentIds: ReadonlySet<string>;
  /** 这次刚点了「不感兴趣」、还能就地撤销的几条。 */
  dismissedIds: ReadonlySet<string>;
  /** 「加来源」浮层开着（第二栏顶上的 + 开它）。 */
  sourcesOpen: boolean;
  /** 抖音收藏的勾选清单开着（第二栏里再点一下「抖音收藏」、来源管理里开它）。 */
  douyinOpen: boolean;
}

export class FeedUi {
  readonly store = new Store<FeedUiState>({ expandedIds: new Set(), adding: false, includeHidden: false,
    savedOnly: false, kind: null, commentIds: new Set(), dismissedIds: new Set(), sourcesOpen: false,
    douyinOpen: false });

  setSourcesOpen(sourcesOpen: boolean): void {
    this.store.set((state) => (state.sourcesOpen === sourcesOpen ? state : { ...state, sourcesOpen }));
  }

  setDouyinOpen(douyinOpen: boolean): void {
    this.store.set((state) => (state.douyinOpen === douyinOpen ? state : { ...state, douyinOpen }));
  }

  segment(): FeedSegment {
    const { savedOnly, kind } = this.store.get();
    return savedOnly ? 'saved' : kind ?? 'all';
  }

  setSegment(segment: FeedSegment): void {
    const savedOnly = segment === 'saved';
    const kind = segment === 'all' || segment === 'saved' ? null : segment;
    this.store.set((state) => (state.savedOnly === savedOnly && state.kind === kind ? state
      : { ...state, savedOnly, kind }));
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
