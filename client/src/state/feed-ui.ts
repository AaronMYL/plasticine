import type { FeedNavSource, FeedPlace } from '../api/shared.ts';
import type { FeedListQuery } from '../api/types.ts';
import { Store } from './store.ts';

export type FeedKind = NonNullable<FeedListQuery['kind']>;
export type FeedSegment = 'all' | FeedKind | 'saved' | `source:${string}` | `place:${'x' | 'xhs'}:${FeedPlace}`;

const SOURCE_PREFIX = 'source:';
const PLACE_PREFIX = 'place:';

export function sourceSegment(sourceId: string): FeedSegment {
  return `${SOURCE_PREFIX}${sourceId}`;
}

export function placeSegment(kind: 'x' | 'xhs', place: FeedPlace): FeedSegment {
  return `${PLACE_PREFIX}${kind}:${place}`;
}

export interface FeedUiState {
  expandedIds: ReadonlySet<string>;
  adding: boolean;
  includeHidden: boolean;
  savedOnly: boolean;
  kind: FeedKind | null;
  sourceId: string | null;
  place: FeedPlace | null;
  commentIds: ReadonlySet<string>;
  dismissedIds: ReadonlySet<string>;
  sourcesOpen: boolean;
  douyinOpen: boolean;
  settingsSource: FeedNavSource | null;
  addKind: FeedAddKind;
}

export const FEED_ADD_KINDS = ['url', 'reddit', 'interest', 'x', 'xhs', 'douyin'] as const;
export type FeedAddKind = (typeof FEED_ADD_KINDS)[number];

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
