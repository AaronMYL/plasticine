// 阅读的来源按种类分（第13批，11-14 Aaron：「第二栏『来源』里每种只显示一次；进去显示这一种的全部，顶上能切同类里的
// 不同项」）：兴趣、X、小红书、抖音收藏、Reddit、博客各一行（Reddit 和博客没加过就不出）；进去顶上一排筛选——X 正在关注 /
// 为你推荐 / 书签，小红书推荐 / 收藏，Reddit 按版块，博客按站点。这里只管怎么分、怎么数、哪一行是当前的。

import {
  FEED_NAV_KINDS,
  FEED_NAV_LABELS,
  type FeedNavKind,
  type FeedNavResponse,
  type FeedNavSource,
  type FeedPlace,
} from '../../api/shared.ts';
import { placeSegment, sourceSegment, type FeedSegment } from '../../state/feed-ui.ts';

/** 每种一个色点（设计稿「阅读来源与筛选」）。 */
export const KIND_HUES: Readonly<Record<FeedNavKind, string>> = {
  news: 'var(--hue-ochre)', x: 'var(--fg)', xhs: 'var(--hue-rose)', douyin: 'var(--hue-sky)',
  reddit: 'var(--hue-clay)', rss: 'var(--hue-teal)',
};

/** X、小红书顶上那一排：在哪一处看到的。 */
export const PLACE_CHIPS: Readonly<Record<'x' | 'xhs', readonly (readonly [FeedPlace, string])[]>> = {
  x: [['following', '正在关注'], ['recommend', '为你推荐'], ['bookmark', '书签']],
  xhs: [['recommend', '推荐'], ['saved', '收藏']],
};

export interface KindGroup {
  kind: FeedNavKind;
  label: string;
  /** 这一种的来源（内置的一个；Reddit 每个版块、博客每个站点一个）。 */
  rows: FeedNavSource[];
  /** 今天新来的（这一种加起来）。 */
  count: number;
  /** 有一个没取到就写它的原因。 */
  problem: string | null;
  /** 全都暂停了。 */
  paused: boolean;
}

/** 第二栏的来源：按种类合成一行，次序固定；Reddit、博客一个都没加时不出。 */
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

/** 分段落在哪一种上（一个版块、某一处都算那一种）；全部、收藏是 null。 */
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
  /** 选中这一个版块 / 博客时，管它用的那一行。 */
  row: FeedNavSource | null;
}

/** 一种的筛选：全部，加上在哪一处（X、小红书）或每个版块、博客；兴趣、抖音收藏只有全部，不出这一排。 */
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
