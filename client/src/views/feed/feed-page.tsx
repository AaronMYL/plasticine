// 信息流页（第 3 批，用户 11-04 定；11-07 设计稿 Feed）：瀑布流卡片——有图的大卡、没图的短卡，电脑两三列按宽度、手机
// 一列；命中关注点的排前面。看哪一路（全部 · 收藏 · 每个来源）在第二栏选（feed-column.tsx），主区顶上一行写这一路的
// 名字。第 7 批第 10 条：来源都在第二栏管——+ 开「加来源」，每行 ⋯ 的「设置…」开这个来源的设置（这两个浮层挂在这页），
// 抖音收藏的勾选清单在第二栏里再点一下「抖音收藏」或它的 ⋯。读失败就地说原因并给「重新读取」，手里有一份就照常显示那
// 一份。瀑布流按每条原样估高分列，卡片收成「不感兴趣 · 撤销」的占位时列不重排，只是那一列下面的卡平滑上移。手机没有
// 第二栏：页头「筛选」抽屉里是同一份来源列表和 ⋯。

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { COGNITION_PAGE_DEFAULT, type FeedNavSource } from '../../api/shared.ts';
import type { FeedItemView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import type { ActionOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { segmentOf, type FeedSegment } from '../../state/feed-ui.ts';
import { useStore } from '../../state/use-store.ts';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import { TitlebarTitle, useInTitlebar } from '../../shell/titlebar.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { useRoute } from '../../shell/use-route.ts';
import { usePhone } from '../../shell/use-viewport-width.ts';
import { PendingOps } from '../pending/pending-ops.tsx';
import { FeedCard } from './feed-card.tsx';
import { feedText } from './feed-text.ts';
import { cardHeight, COLUMN_GAP_PX, columnCount, layoutColumns } from './feed-masonry.ts';
import { DouyinSheet } from './douyin-sheet.tsx';
import { FeedAdd } from './feed-add.tsx';
import { useFeedNav } from './feed-nav-data.ts';
import { FeedSourceList } from './feed-source-list.tsx';
import { FeedSourceSettings } from './feed-source-settings.tsx';
import { FeedTarget } from './feed-target.tsx';
import './feed.css';

const SEGMENT_LABELS: Readonly<Record<Exclude<FeedSegment, `source:${string}`>, string>> = {
  all: '全部',
  saved: '收藏',
  x: 'X 关注',
  rss: 'RSS',
  news: '按关注点的新闻',
  douyin: '抖音收藏',
  reddit: 'Reddit',
};

// 估高（feed.css）：「展开 / 译自…」那一行 18 + 间距 10；小图表 64 + 说明 18 + 间距 18；抖音的一条要点约一行半。
const TOOLS_ROW_PX = 28;
const CHART_PX = 100;
const POINT_CHARS = 30;

const EMPTY_TEXT: Readonly<Record<string, string>> = {
  all: '还没有内容。点第二栏顶上的 + 加个来源，有了就出现在这里。',
  x: '还没有 X 上的内容。',
  news: '还没有新闻。',
  douyin: '还没有处理过的抖音收藏。',
  saved: '还没有收藏。',
};
const EMPTY_SOURCE = '这个来源还没有内容。';

export function FeedPage(): ReactNode {
  const { route } = useRoute();
  return route.feedItemId == null ? <FeedListPage /> : <FeedTarget key={route.feedItemId} id={route.feedItemId} />;
}

/** 手机的「筛选」抽屉：和电脑第二栏同一份来源列表（每行的 ⋯ 也在），底下「加来源」。 */
function PhoneFilter({ segment, onShow, onAdd, onSettings, onDouyin }: { segment: FeedSegment;
  onShow: (segment: FeedSegment) => void; onAdd: () => void; onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void }): ReactNode {
  const { nav, error } = useFeedNav();
  return (
    <div className="feed-filter">
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <FeedSourceList nav={nav} segment={segment} onList onShow={onShow} onSettings={onSettings}
        onDouyin={onDouyin} />
      <button type="button" className="secondary-button feed-filter-add" onClick={onAdd}>加来源</button>
    </div>
  );
}

/** 主区内容宽度：分几列看它（展开对话、拖宽聊天栏都会变）。jsdom 和第一次量之前是 0，按一列排。 */
function useWidth(): { ref: RefObject<HTMLDivElement | null>; width: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) { return undefined; }
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') { return undefined; }
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Masonry({ items, dismissed }: { items: readonly FeedItemView[]; dismissed: ReadonlySet<string> }): ReactNode {
  const phone = usePhone();
  const { ref, width } = useWidth();
  const count = phone ? 1 : columnCount(width);
  const columnWidth = count === 1 ? width : (width - COLUMN_GAP_PX * (count - 1)) / count;
  const columns = useMemo(() => layoutColumns(items, count, (item) => {
    const text = feedText(item);
    const tools = text.expandable || text.from !== null ? TOOLS_ROW_PX : 0;
    const points = (item.video?.points.length ?? 0) + (item.video?.related.length ?? 0);
    return cardHeight({
      textChars: points > 0 ? points * POINT_CHARS : Array.from(text.lead).length,
      title: item.kind !== 'x', hit: item.concernId !== null,
      imageRatio: item.image === null ? undefined : item.image.ratio,
      extraPx: tools + (item.chart == null ? 0 : CHART_PX),
    }, columnWidth);
  }), [items, count, columnWidth]);
  return (
    <div ref={ref} className="feed-masonry" role="list" data-columns={count}>
      {columns.map((column, index) => (
        <div key={index} className="feed-column" role="none">
          {column.map((item) => (
            <FeedCard key={item.id} item={item} collapsed={item.reaction === 'dislike' && dismissed.has(item.id)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FeedListPage(): ReactNode {
  const live = useLive();
  const { feedUi } = useClientState();
  const data = useStore(live.feed.data);
  const sources = useStore(live.feed.sources);
  const refresh = useStore(live.feed.refresh.state);
  const ui = useStore(feedUi.store);
  const segment = segmentOf(ui);
  const phone = usePhone();
  const adding = ui.sourcesOpen;
  const douyin = ui.douyinOpen;
  const setAdding = (open: boolean): void => feedUi.setSourcesOpen(open);
  const setDouyin = (open: boolean): void => feedUi.setDouyinOpen(open);
  // 手机（设计稿 Phone-Feed）：页头只有标题和「筛选」，分段和「加来源」收进筛选的抽屉。
  const [filtering, setFiltering] = useState(false);
  useEffect(() => {
    live.feed.settleDismissed();
    live.feed.open();
    // 「不感兴趣 · 撤销」的占位只留在这一会儿：离开信息流页就收走。
    return () => live.feed.settleDismissed();
  }, [live.feed]);
  const itemIds = new Set(data.items.map((item) => item.id));
  const sourceIds = new Set(
    [sources.sources?.interests, sources.sources?.blocked, sources.sources?.others]
      .flatMap((list) => list ?? [])
      .map((source) => source.id),
  );
  const visible = (op: ActionOp): boolean => {
    const { request } = op;
    if (request.kind === 'feed_refresh') { return refresh.busy; }
    if (request.kind === 'feed_interest') { return true; }
    if (request.kind === 'feed_block') {
      return sources.sources?.recentSites.some((site) => site.site === request.body.site) ?? false;
    }
    if ('itemId' in request) { return itemIds.has(request.itemId); }
    return 'sourceId' in request && sourceIds.has(request.sourceId);
  };
  // 桌面客户端里来源名写在标题栏里（11-08），主区不再画只写着来源名的那条顶栏。
  const titled = useInTitlebar();
  const loading = data.status === 'idle' || data.status === 'loading';
  const viewed = ui.sourceId === null ? undefined : sources.sources?.others.find((row) => row.id === ui.sourceId);
  const label = segment.startsWith('source:') ? viewed?.label ?? '' : SEGMENT_LABELS[segment as 'all'];
  const empty = ui.sourceId === null ? EMPTY_TEXT[segment] ?? EMPTY_TEXT['all'] : EMPTY_SOURCE;
  const settings = ui.settingsSource;
  return (
    <div className="page feed">
      {phone ? (
        <PageHeader title="信息流" phoneSearch={false} phoneTools={(
          <IconButton icon="filter" label="筛选" size={17} aria-haspopup="dialog" aria-expanded={filtering}
            aria-pressed={segment !== 'all'} onClick={() => setFiltering(true)} />
        )} />
      ) : titled ? (label === '' ? null : <TitlebarTitle text={label} />) : (
        <header className="feed-top">
          <h2 className="feed-top-title">{label}</h2>
        </header>
      )}
      <PendingOps
        label="还没了结的信息流操作"
        prefixes={['feed:']}
        visible={visible}
        onRetry={(key) => void live.feedActions.retry(key)}
      />
      {data.error === null ? null : (
        <p className="block-empty is-error" role="alert">
          {data.error}{' '}
          <button type="button" className="text-button" onClick={() => void live.feed.reload()}>
            重新读取
          </button>
        </p>
      )}
      <section className="feed-board" aria-label="条目">
        {loading ? <p className="block-empty">正在读信息流…</p> : null}
        {data.status === 'ready' && data.items.length === 0 ? <p className="block-empty">{empty}</p>
          : null}
        <Masonry items={data.items} dismissed={ui.dismissedIds} />
        {data.moreError === null ? null : (
          <p className="block-empty is-error" role="alert">
            {data.moreError}
          </p>
        )}
        {data.nextOffset === null ? null : (
          <button
            type="button"
            className="text-button feed-more"
            disabled={data.loadingMore}
            onClick={() => void live.feed.more()}
          >
            {data.loadingMore ? '正在读…' : `再读 ${COGNITION_PAGE_DEFAULT} 条`}
          </button>
        )}
      </section>
      <Sheet open={filtering} variant="drawer" className="sheet-fit" title="筛选"
        onClose={() => setFiltering(false)}>
        <PhoneFilter segment={segment} onShow={(next) => {
          void live.feed.setSegment(next);
          setFiltering(false);
        }} onAdd={() => {
          setFiltering(false);
          feedUi.openAdd();
        }} onSettings={(row) => {
          setFiltering(false);
          feedUi.setSettingsSource(row);
        }} onDouyin={() => {
          setFiltering(false);
          setDouyin(true);
        }} />
      </Sheet>
      <Sheet open={adding} variant={phone ? 'drawer' : 'panel'} className="sheet-fit" title="加来源"
        onClose={() => setAdding(false)}>
        <FeedAdd onClose={() => setAdding(false)} onDouyin={() => {
          setAdding(false);
          setDouyin(true);
        }} />
      </Sheet>
      <Sheet open={settings !== null} variant={phone ? 'drawer' : 'panel'} className="sheet-fit"
        title={settings === null ? '设置' : `${settings.label} · 设置`}
        onClose={() => feedUi.setSettingsSource(null)}>
        {settings === null ? null : <FeedSourceSettings key={settings.source.id} row={settings}
          onClose={() => feedUi.setSettingsSource(null)} onDouyin={() => {
            feedUi.setSettingsSource(null);
            setDouyin(true);
          }} />}
      </Sheet>
      <DouyinSheet open={douyin} onClose={() => setDouyin(false)} />
    </div>
  );
}
