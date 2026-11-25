import { FEED_NAV_LABELS, type FeedNavKind, type FeedNavResponse, type FeedNavSource } from '../../shared/api/index.ts';
import type { FeedSource } from '../../shared/state.ts';
import { dayRange, localDay } from '../daily/index.ts';
import { DOUYIN_SOURCE } from '../video/index.ts';
import type { AppDeps } from './context.ts';
import { feedSourceView } from './daily-views.ts';

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
      ...(kind === 'x' || kind === 'xhs' ? { places: state.feedItems.countByPlace(source.id, from, before) } : {}),
    };
  };
  const added = (kind: 'rss' | 'reddit'): FeedNavSource[] => state.feedSources.all({ kind })
    .filter((source) => source.query !== null)
    .map((source) => row(kind, source, bySource.get(source.id) ?? 0));
  const douyin = state.feedSources.ensure({ ...DOUYIN_SOURCE, level: 'normal' });
  const sources = [
    row('news', deps.daily.subscriptions.builtIn('news'), kinds.news),
    row('x', deps.daily.subscriptions.builtIn('x'), kinds.x),
    row('xhs', deps.daily.subscriptions.builtIn('xhs'), kinds.xhs),
    row('douyin', douyin, kinds.douyin, douyinProblem(deps)),
    ...added('reddit'),
    ...added('rss'),
  ];
  return { all: kinds.x + kinds.rss + kinds.news + kinds.douyin + kinds.reddit + kinds.xhs + kinds.manual, sources };
}
