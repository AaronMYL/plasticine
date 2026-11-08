// 信息流第二栏的数据（第 7 批第 10 条，他定）：「全部」的个数，和每个来源一行——X 关注、抖音收藏、按关注点的新闻
// （内置三种，第一次要时建出来），每个订阅、每个 Reddit 版块各一行。每行带来源本身（暂停就是 level = off）、今天新来
// 几条、上次没取到的原因；抖音收藏的「原因」是同步的状态（等电脑上线、没做成），登录状态只在电脑上。

import { FEED_NAV_LABELS, type FeedNavKind, type FeedNavResponse, type FeedNavSource } from '../../shared/api/index.ts';
import type { FeedSource } from '../../shared/state.ts';
import { dayRange, localDay } from '../daily/index.ts';
import { DOUYIN_SOURCE } from '../video/index.ts';
import type { AppDeps } from './context.ts';
import { feedSourceView } from './daily-views.ts';

/** 抖音收藏的同步等电脑上线时那一行写什么。 */
export const DOUYIN_WAITING_TEXT = '等电脑上线再同步';

function douyinProblem(deps: Pick<AppDeps, 'video'>): string | null {
  const sync = deps.video.douyin.syncView();
  if (sync.state === 'failed') {
    return sync.error ?? '上次同步没做成';
  }
  return sync.state === 'waiting_mac' ? DOUYIN_WAITING_TEXT : null;
}

export function navOf(deps: Pick<AppDeps, 'state' | 'daily' | 'video' | 'now'>, timeZone: string): FeedNavResponse {
  const { state } = deps;
  const { start, end } = dayRange(localDay(deps.now(), timeZone), timeZone);
  const from = start.toISOString();
  const before = end.toISOString();
  const kinds = state.feedItems.countByKind(from, before);
  const bySource = state.feedItems.countBySource(from, before);
  const statuses = state.feedSourceStatus.all();
  const row = (kind: FeedNavKind, source: FeedSource, count: number, problem?: string | null): FeedNavSource => {
    const status = statuses.get(source.id);
    return {
      kind,
      label: kind === 'rss' || kind === 'reddit' ? source.label : FEED_NAV_LABELS[kind],
      source: feedSourceView(source, status),
      count,
      problem: problem === undefined ? status?.error ?? null : problem,
    };
  };
  const added = (kind: 'rss' | 'reddit'): FeedNavSource[] => state.feedSources.all({ kind })
    .filter((source) => source.query !== null)
    .map((source) => row(kind, source, bySource.get(source.id) ?? 0));
  const douyin = state.feedSources.ensure({ ...DOUYIN_SOURCE, level: 'normal' });
  const sources = [
    row('x', deps.daily.subscriptions.builtIn('x'), kinds.x),
    row('douyin', douyin, kinds.douyin, douyinProblem(deps)),
    row('news', deps.daily.subscriptions.builtIn('news'), kinds.news),
    ...added('reddit'),
    ...added('rss'),
  ];
  return { all: kinds.x + kinds.rss + kinds.news + kinds.douyin + kinds.reddit + kinds.manual, sources };
}
