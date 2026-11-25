import {
  FEED_NAV_KINDS,
  FEED_NAV_LABELS,
  type FeedNavKind,
  type FeedNavResponse,
  type FeedNavSource,
  type FeedPlace,
} from '../../api/shared.ts';
import { placeSegment, sourceSegment, type FeedSegment } from '../../state/feed-ui.ts';

export const KIND_HUES: Readonly<Record<FeedNavKind, string>> = {
  news: 'var(--hue-ochre)', x: 'var(--fg)', xhs: 'var(--hue-rose)', douyin: 'var(--hue-sky)',
  reddit: 'var(--hue-clay)', rss: 'var(--hue-teal)',
};

export const PLACE_CHIPS: Readonly<Record<'x' | 'xhs', readonly (readonly [FeedPlace, string])[]>> = {
  x: [['following', '正在关注'], ['recommend', '为你推荐'], ['bookmark', '书签']],
  xhs: [['recommend', '推荐'], ['saved', '收藏']],
};

export interface KindGroup {
  kind: FeedNavKind;
  label: string;
  rows: FeedNavSource[];
  count: number;
  problem: string | null;
  paused: boolean;
}

export function kindGroups(nav: FeedNavResponse | null): KindGroup[] {
  if (nav === null) return [];
  return FEED_NAV_KINDS.flatMap((kind) => {
    const rows = nav.sources.filter((row) => row.kind === kind);
    if (rows.length === 0) return [];
    const problem = rows.find((row) => row.problem !== null && row.source.level !== 'off');
    return [{
      kind, label: FEED_NAV_LABELS[kind], rows,
      count: rows.reduce((sum, row) => sum + row.count, 0),
      problem: problem === undefined ? null
        : rows.length === 1 ? problem.problem : `${problem.label}：${problem.problem}`,
      paused: rows.every((row) => row.source.level === 'off'),
    }];
  });
}

export function kindOfSegment(segment: FeedSegment, nav: FeedNavResponse | null): FeedNavKind | null {
  if (segment === 'all' || segment === 'saved') return null;
  if (segment.startsWith('place:')) return segment.split(':')[1] as FeedNavKind;
  if (segment.startsWith('source:')) {
    const id = segment.slice('source:'.length);
    return nav?.sources.find((row) => row.source.id === id)?.kind ?? null;
  }
  return segment as FeedNavKind;
}

export interface KindChip {
  segment: FeedSegment;
  label: string;
  count: number | null;
  row: FeedNavSource | null;
}

export function kindChips(group: KindGroup): KindChip[] {
  const all: KindChip = { segment: group.kind, label: '全部', count: group.count, row: null };
  if (group.kind === 'x' || group.kind === 'xhs') {
    const counts = group.rows[0]?.places ?? {};
    const kind = group.kind;
    return [all, ...PLACE_CHIPS[kind].map(([place, label]) => ({ segment: placeSegment(kind, place), label,
      count: counts[place] ?? 0, row: null }))];
  }
  if (group.kind === 'reddit' || group.kind === 'rss') {
    return [all, ...group.rows.map((row) => ({ segment: sourceSegment(row.source.id), label: row.label,
      count: row.count, row }))];
  }
  return [];
}
