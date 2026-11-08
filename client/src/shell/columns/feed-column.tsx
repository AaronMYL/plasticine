// 信息流栏目的第二栏（第 7 批第 10 条，他定；设计稿 Feed-Sources）：顶上「全部」「收藏」，下面「来源」每个来源一行，
// 每行的 ⋯ 管这个来源（现在刷新 / 设置… / 暂停 / 删除），列表本身在 views/feed/feed-source-list.tsx（手机的「筛选」
// 抽屉用同一份）。点一行换主区看的那一路；看着抖音收藏时再点一下开勾选清单。顶上 + 是唯一的「加来源」入口。
// 订阅（研究周报这类）挪到资料库了，这里不再列。

import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { segmentOf, type FeedSegment } from '../../state/feed-ui.ts';
import { useStore } from '../../state/use-store.ts';
import { useFeedNav } from '../../views/feed/feed-nav-data.ts';
import { FeedSourceList } from '../../views/feed/feed-source-list.tsx';
import { IconButton } from '../icon-button.tsx';
import type { Route } from '../routes.ts';
import { ColumnHead, ColumnNote } from './column.tsx';

const FEED_ROUTE: Route = { view: 'feed', noteId: null };

export function FeedColumn({ route, navigate }: { route: Route; navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  const { feedUi } = useClientState();
  const ui = useStore(feedUi.store);
  const { nav, error } = useFeedNav();
  const onList = route.view === 'feed' && route.feedItemId == null;
  const segment = segmentOf(ui);
  const toList = (): void => {
    if (!onList) navigate(FEED_ROUTE);
  };
  const show = (next: FeedSegment): void => {
    if (onList && segment === next && next === 'douyin') {
      feedUi.setDouyinOpen(true);
      return;
    }
    void live.feed.setSegment(next);
    toList();
  };
  return (
    <>
      <ColumnHead title="信息流">
        <IconButton icon="plus" label="加来源" aria-haspopup="dialog" aria-expanded={ui.sourcesOpen}
          onClick={() => {
            toList();
            feedUi.openAdd();
          }} />
      </ColumnHead>
      <div className="column-scroll">
        {error === null ? null : <ColumnNote>{error}</ColumnNote>}
        <FeedSourceList nav={nav} segment={segment} onList={onList} onShow={show}
          onSettings={(row) => {
            toList();
            feedUi.setSettingsSource(row);
          }}
          onDouyin={() => {
            toList();
            feedUi.setDouyinOpen(true);
          }} />
      </div>
    </>
  );
}
