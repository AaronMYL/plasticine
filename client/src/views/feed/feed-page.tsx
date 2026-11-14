// 信息流页（第 3 批，用户 11-04 定；11-07 设计稿 Feed；11-11 第 11 批改成单列）：一列条目，命中关注点的排前面。
// 看哪一路（信息流 · 收藏 · 每个来源）在阅读第二栏选（reading-column.tsx），主区顶上一行写这一路的
// 名字。第 7 批第 10 条：来源都在第二栏管——+ 开「加来源」，每行 ⋯ 的「设置…」开这个来源的设置（这两个浮层挂在这页），
// 抖音收藏的勾选清单在第二栏里再点一下「抖音收藏」或它的 ⋯。读失败就地说原因并给「再读一次」，手里有一份就照常显示那
// 一份。手机没有第二栏：页头标题「阅读」，下面分段切信息流和图书馆，「筛选」抽屉里是同一份来源列表和 ⋯。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FEED_NAV_KINDS, FEED_NAV_LABELS, type FeedNavSource } from '../../api/shared.ts';
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
import { DouyinPage } from './douyin-page.tsx';
import { DouyinSheet } from './douyin-sheet.tsx';
import { FeedAdd } from './feed-add.tsx';
import { FeedKindHead, useKindRefresh } from './feed-kind-head.tsx';
import { kindGroups, kindOfSegment } from './feed-kinds.ts';
import { useFeedNav } from './feed-nav-data.ts';
import { FeedSourceList } from './feed-source-list.tsx';
import { FeedSourceSettings } from './feed-source-settings.tsx';
import { FeedTarget } from './feed-target.tsx';
import { FeedToast } from './feed-toast.tsx';
import './feed.css';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { ReadingTabs } from './reading-tabs.tsx';
import { MoreState, useAutoMore } from './feed-pager.tsx';

const EMPTY_TEXT: Readonly<Record<string, string>> = {
  all: '还没有内容。点第二栏顶上的 + 加个来源，有了就出现在这里。',
  x: '还没有 X 上的内容。',
  xhs: '还没有小红书上的内容。',
  news: '还没有按兴趣找到的新闻。',
  douyin: '还没有处理过的抖音收藏。',
  saved: '还没有收藏。',
};
const EMPTY_SOURCE = '这个来源还没有内容。';

export function FeedPage(): ReactNode {
  const { route } = useRoute();
  return route.feedItemId == null ? <FeedListPage /> : <FeedTarget key={route.feedItemId} id={route.feedItemId} />;
}

/** 手机的「管理来源」抽屉：和电脑第二栏同一份来源列表（每行的 ⋯ 也在），底下「加来源」。 */
function PhoneFilter({ segment, onShow, onAdd, onSettings, onDouyin, onAddKind }: { segment: FeedSegment;
  onShow: (segment: FeedSegment) => void; onAdd: () => void; onSettings: (row: FeedNavSource) => void;
  onDouyin: () => void; onAddKind: (kind: 'reddit' | 'url') => void }): ReactNode {
  const { nav, error } = useFeedNav();
  return (
    <div className="feed-filter">
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <FeedSourceList nav={nav} segment={segment} onList onShow={onShow} onSettings={onSettings}
        onDouyin={onDouyin} onAdd={onAddKind} />
      <button type="button" className="secondary-button feed-filter-add" onClick={onAdd}>加来源</button>
    </div>
  );
}

/** 手机上种类那一排（设计稿「阅读手机」）：全部、兴趣、X、小红书、抖音收藏、Reddit、博客，横着滑。 */
function PhoneKinds({ kinds, current, onShow }: { kinds: readonly (typeof FEED_NAV_KINDS)[number][];
  current: FeedSegment | null; onShow: (segment: FeedSegment) => void }): ReactNode {
  return (
    <div className="feed-chips feed-chips-scroll" role="group" aria-label="看哪一种">
      <button type="button" className="feed-chip" aria-pressed={current === 'all'} onClick={() => onShow('all')}>
        全部</button>
      {kinds.map((kind) => (
        <button key={kind} type="button" className="feed-chip" aria-pressed={current === kind}
          onClick={() => onShow(kind)}>{FEED_NAV_LABELS[kind]}</button>
      ))}
    </div>
  );
}

function Stream({ items, dismissed }: { items: readonly FeedItemView[]; dismissed: ReadonlySet<string> }): ReactNode {
  return (
    <div className="feed-stream" role="list">
      {items.map((item) => (
        <FeedCard key={item.id} item={item} collapsed={item.reaction === 'dislike' && dismissed.has(item.id)} />
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
  const { nav } = useFeedNav();
  const segment = segmentOf(ui);
  const phone = usePhone();
  const adding = ui.sourcesOpen;
  const douyin = ui.douyinOpen;
  const setAdding = (open: boolean): void => feedUi.setSourcesOpen(open);
  const setDouyin = (open: boolean): void => feedUi.setDouyinOpen(open);
  // 手机（设计稿「阅读手机」）：页头是「阅读」、刷新和「管理来源」，下面一排种类、一排这一种的筛选。
  const [filtering, setFiltering] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const groups = kindGroups(nav);
  const kind = kindOfSegment(segment, nav);
  const group = groups.find((entry) => entry.kind === kind) ?? null;
  const kindRefresh = useKindRefresh(group);
  // 第13批：去掉下拉刷新（Aaron）；刷新在第二栏「信息流」那一行、这一种的名字旁边，手机在页头。
  const allRefresh = useKindRefresh(nav === null ? null : { kind: 'news', label: '', rows: nav.sources, count: 0,
    problem: null, paused: false });
  useAutoMore(sentinel, segment !== 'douyin' && data.status === 'ready' && data.nextOffset !== null
    && !data.loadingMore && data.moreError === null, () => void live.feed.more());
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
  // 桌面客户端里名字写在标题栏里（11-08），主区不再画只写着名字的那条顶栏。
  const titled = useInTitlebar();
  const loading = data.status === 'idle' || data.status === 'loading';
  const label = segment === 'saved' ? '收藏' : group?.label ?? '信息流';
  const empty = ui.sourceId === null ? EMPTY_TEXT[kind ?? segment] ?? EMPTY_TEXT['all'] : EMPTY_SOURCE;
  const settings = ui.settingsSource;
  const show = (next: FeedSegment): void => void live.feed.setSegment(next);
  const addKind = (next: 'reddit' | 'url'): void => feedUi.openAdd(next);
  return (
    <div className={`page feed${segment === 'douyin' ? ' page-fill feed-douyin' : ''}`}>
      <FeedToast />
      {phone ? (
        <>
          <PageHeader title="阅读" phoneSearch={false} phoneTools={(
            <>
              <IconButton icon="refresh" label={group === null ? '刷新全部来源' : `刷新${group.label}`} size={17}
                disabled={(group === null ? allRefresh : kindRefresh).busy}
                onClick={(group === null ? allRefresh : kindRefresh).run} />
              <IconButton icon="filter" label="管理来源" size={17} aria-haspopup="dialog" aria-expanded={filtering}
                onClick={() => setFiltering(true)} />
            </>
          )} />
          <ReadingTabs current="feed" />
          <PhoneKinds kinds={groups.map((entry) => entry.kind)} current={kind ?? (segment === 'all' ? 'all' : null)}
            onShow={show} />
        </>
      ) : titled ? <TitlebarTitle text={label} /> : group === null ? (
        <header className="feed-top">
          <h2 className="feed-top-title">{label}</h2>
        </header>
      ) : null}
      {group === null || group.kind === 'douyin' ? null : <FeedKindHead group={group} segment={segment}
        titled={!phone && !titled} refresh={!phone} onShow={show} onSettings={(row) => feedUi.setSettingsSource(row)}
        onDouyin={() => setDouyin(true)} onAdd={addKind} />}
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
            再读一次
          </button>
        </p>
      )}
      {segment === 'douyin' ? <DouyinPage phone={phone} onSelect={() => setDouyin(true)} />
        : <section className="feed-board" aria-label="条目">
        {loading ? <PageLoading /> : null}
        {data.status === 'ready' && data.items.length === 0 ? <p className="block-empty">{empty}</p>
          : null}
        <Stream items={data.items} dismissed={ui.dismissedIds} />
        <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />
        {data.status !== 'ready' || data.items.length === 0 ? null
          : <MoreState loading={data.loadingMore} end={data.nextOffset === null} error={data.moreError}
            onRetry={() => void live.feed.more()} />}
      </section>}
      <Sheet open={filtering} variant="drawer" className="sheet-fit" title="管理来源"
        onClose={() => setFiltering(false)}>
        <PhoneFilter segment={segment} onShow={(next) => {
          show(next);
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
        }} onAddKind={(next) => {
          setFiltering(false);
          addKind(next);
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
