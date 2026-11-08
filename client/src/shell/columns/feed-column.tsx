// 信息流栏目的第二栏（11-07 设计稿 Feed）：全部 → 订阅 → 来源（X 关注、RSS、按关注点的新闻、抖音收藏、收藏），个数是
// 今天新来的（零不写，收藏不数）。点一行换主区看的那一路；订阅点了打开最新一期（空间），有新一期没看带一个点；
// 已经在看抖音收藏时再点一下开勾选清单。顶上 + 开「加来源」。
// 数据：GET /v2/feed/nav（全部、来源）；订阅那一节它还是空的，用 GET /v2/subscriptions 补上。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { FeedNavResponse, FeedNavSourceKey, SubscriptionListResponse } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import type { FeedSegment } from '../../state/feed-ui.ts';
import { useStore } from '../../state/use-store.ts';
import { seenSpace } from '../../views/spaces/space-seen.ts';
import { HueTile } from '../hue.tsx';
import { IconButton } from '../icon-button.tsx';
import { Icon, type IconName } from '../icons.tsx';
import type { Route } from '../routes.ts';
import { ColumnCount, ColumnHead, ColumnLabel, ColumnLink, ColumnNote } from './column.tsx';

const SOURCE_ICONS: Readonly<Record<FeedNavSourceKey, IconName>> = {
  x: 'hash', rss: 'feed', news: 'globe', douyin: 'play', saved: 'star',
};

const FEED_ROUTE: Route = { view: 'feed', noteId: null };

function useFeedNav(): { nav: FeedNavResponse | null; subs: SubscriptionListResponse | null; error: string | null } {
  const api = useApi();
  const timeZone = useTimeZone();
  const live = useLive();
  const data = useStore(live.feed.data);
  const [nav, setNav] = useState<FeedNavResponse | null>(null);
  const [subs, setSubs] = useState<SubscriptionListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 信息流读到新的（刷新、加了来源）时一起重读个数。
  const revision = `${data.status}:${data.items.length}:${data.newToday}`;
  useEffect(() => {
    const controller = new AbortController();
    const fail = (cause: unknown): void => {
      if (!controller.signal.aborted) setError(errorText(cause));
    };
    api.feed.nav(timeZone, controller.signal).then(setNav, fail);
    api.subscriptions.list(controller.signal).then(setSubs, fail);
    return () => controller.abort();
  }, [api, timeZone, revision]);
  return { nav, subs, error };
}

export function FeedColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  const { feedUi } = useClientState();
  const ui = useStore(feedUi.store);
  const { nav, subs, error } = useFeedNav();
  const onList = route.view === 'feed' && route.feedItemId == null;
  const segment: FeedSegment = ui.savedOnly ? 'saved' : ui.kind ?? 'all';
  const show = (next: FeedSegment): void => {
    if (onList && segment === next && next === 'douyin') {
      feedUi.setDouyinOpen(true);
      return;
    }
    void live.feed.setSegment(next);
    if (!onList) navigate(FEED_ROUTE);
  };
  const row = (key: FeedSegment, label: string, icon: IconName, count: number | null): ReactNode => (
    <button key={key} type="button" className="column-item" aria-current={onList && segment === key ? 'page'
      : undefined} onClick={() => show(key)}>
      <span className="column-item-lead"><Icon name={icon} size={16} /></span>
      <span className="column-item-text">{label}</span>
      <span className="column-item-trail"><ColumnCount value={count} label="条新的" /></span>
    </button>
  );
  const subscriptions = subs?.subscriptions.filter((item) => item.latest !== null || item.status !== 'draft') ?? [];
  return (
    <>
      <ColumnHead title="信息流">
        <IconButton icon="plus" label="加来源或订阅" aria-haspopup="dialog" aria-expanded={ui.sourcesOpen}
          onClick={() => {
          if (!onList) navigate(FEED_ROUTE);
          feedUi.setSourcesOpen(true);
        }} />
      </ColumnHead>
      <div className="column-scroll">
        {row('all', '全部', 'feed', nav?.all ?? null)}
        {error === null ? null : <ColumnNote>{error}</ColumnNote>}
        {subscriptions.length === 0 ? null : <>
          <ColumnLabel>订阅</ColumnLabel>
          {subscriptions.map((item) => {
            const latest = item.latest;
            const target: Route = latest === null ? { view: 'books', noteId: null, bookId: null, spacesList: true }
              : { view: 'books', noteId: null, bookId: null, spaceId: latest.spaceId };
            const fresh = latest !== null && !seenSpace(latest.spaceId);
            return (
              <ColumnLink key={item.id} route={target} current={route.view === 'books'
                && latest !== null && route.spaceId === latest.spaceId} navigate={navigate}
                lead={<HueTile hue={item.kind === 'research' ? 'sky' : 'teal'}
                  icon={item.kind === 'research' ? 'space' : 'sparkle'} size={22} />}
                trail={fresh ? <span className="column-fresh" role="img" aria-label="新一期" /> : undefined}>
                {item.title}
              </ColumnLink>
            );
          })}
        </>}
        {nav === null ? null : <>
          <ColumnLabel>来源</ColumnLabel>
          {nav.sources.map((source) => row(source.key, source.label, SOURCE_ICONS[source.key], source.count))}
        </>}
      </div>
    </>
  );
}
