// 网页栏目的第二栏：竖排标签（《优化清单》第 2 条，11-07 设计稿 Web；参考 Arc、Edge）。从上到下：搜标签、书签一节
// （第 8 批第 1 条，11-09：书签和标签分开，web-bookmarks.tsx）、一道细线、置顶（一排图标，四个一行）、分组（组标题点了
// 整组收起展开，有高度动画）、今天打开的；最底下「新标签」。
// 一行：网站首字母小方块 + 标题，当前那一个是 --bg 底加细线、行尾 ×。拖动排序、拖进分组、拖到置顶（web-tab-drag.ts），
// 右键出菜单（web-tab-menu.tsx）。搜标签时下面换成一张平的结果：开着的标签、书签、关掉的（点了重开）。

import { useContext, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import type { ArchivedTab, WebTab, WebTabGroup } from '../../state/web-tabs.ts';
import { bookmarkTitle, openTabFor, webBookmarks } from '../../views/bookmarks/bookmark-address.ts';
import { Collapse } from '../collapse.tsx';
import { FlipList } from '../flip-list.tsx';
import { hueVar } from '../hue.tsx';
import { Icon } from '../icons.tsx';
import { pointAnchor, type PopoverAnchor } from '../popover.tsx';
import { SiteIcon } from '../site-icon.tsx';
import { NativeWebTabsContext } from '../use-native-web-tabs.ts';
import { useTabActions } from '../tabs-context.ts';
import { ColumnFoot, ColumnLabel } from './column.tsx';
import { WebSectionHead } from './web-section-head.tsx';
import { ColumnCollapseButton } from './column-toggle.tsx';
import { BookmarkButton, useOpenBookmark, WebBookmarks } from './web-bookmarks.tsx';
import { useTabDrag } from './web-tab-drag.ts';
import './web-column.css';
import { GroupMenu, TabMenu } from './web-tab-menu.tsx';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (cause) {
    console.warn('标签的网址解不开，用标题当网站名', cause);
    return '';
  }
}

function tabTitle(tab: Pick<WebTab, 'title' | 'url'>): string {
  return tab.title.trim() === '' ? hostOf(tab.url) || tab.url : tab.title;
}

/** 查找时历史里最多列这么多条。 */
const HISTORY_HITS = 8;
/** 「分组」「今天」两节收没收起，和各栏目的第二栏记在同一处（shell-prefs 的 collapsedColumns）。 */
const FOLD_GROUPS = 'web:groups';
const FOLD_TODAY = 'web:today';

type Menu = { kind: 'tab'; id: string; anchor: PopoverAnchor } | { kind: 'group'; id: string; anchor: PopoverAnchor };

export interface WebColumnProps {
  /** 主区现在开着的网页标签。 */
  currentId: string | null;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onReopen: (entry: ArchivedTab) => void;
  onNew: () => void;
}

export function WebColumn(props: WebColumnProps): ReactNode {
  const { webTabs, shellPrefs } = useClientState();
  const state = useStore(webTabs.store);
  const folded = useStore(shellPrefs.store).collapsedColumns;
  const history = useContext(NativeWebTabsContext)?.history ?? null;
  const tabActions = useTabActions();
  const bookmarks = webBookmarks(useStore(useLive().bookmarks.data).bookmarks);
  const openBookmark = useOpenBookmark();
  const root = useRef<HTMLDivElement>(null);
  const drag = useTabDrag(root, webTabs);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const contextMenu = (event: MouseEvent, next: Omit<Menu, 'anchor'>): void => {
    event.preventDefault();
    setMenu({ ...next, anchor: pointAnchor(event.clientX, event.clientY) } as Menu);
  };
  const open = (id: string): void => {
    if (!drag.swallowClick()) props.onOpen(id);
  };
  const row = (id: string, indent: boolean): ReactNode => {
    const tab = byId.get(id);
    if (tab === undefined) return null;
    const current = props.currentId === id;
    return (
      <li key={id} data-tab-id={id} className="web-tab-item" data-dragging={drag.dragging === id}
        onPointerDown={(event) => drag.onPointerDown(event, id)}
        onContextMenu={(event) => contextMenu(event, { kind: 'tab', id })}>
        <button type="button" className="web-tab-row" data-indent={indent} aria-current={current ? 'page' : undefined}
          onClick={() => open(id)}>
          <SiteIcon url={tab.url} title={tab.title} tabId={tab.id} />
          <span className="web-tab-title">{tabTitle(tab)}</span>
        </button>
        <button type="button" className="web-tab-close" data-no-drag-tab="" aria-label={`关掉 ${tabTitle(tab)}`}
          data-tip="关掉" onClick={() => props.onClose(id)}>
          <Icon name="close" size={12} />
        </button>
      </li>
    );
  };
  const group = (item: WebTabGroup): ReactNode => (
    <section key={item.id} className="web-group" data-drop-zone={drag.target?.zone === item.id}>
      <button type="button" className="web-group-head" data-group-head={item.id} aria-expanded={!item.collapsed}
        aria-label={`${item.name}，${item.tabIds.length} 个标签`}
        aria-controls={`web-group-${item.id}`} onClick={() => webTabs.toggleGroup(item.id)}
        onContextMenu={(event) => contextMenu(event, { kind: 'group', id: item.id })}>
        <span className="web-group-chevron" aria-hidden="true"><Icon name="chevron-down" size={12} /></span>
        <span className="column-dot" style={{ background: hueVar(item.hue) }} aria-hidden="true" />
        <span className="web-group-name">{item.name}</span>
        <span className="column-count">{item.tabIds.length}</span>
      </button>
      <Collapse open={!item.collapsed} id={`web-group-${item.id}`}>
        <div data-drop-list={`group:${item.id}`}>
          <FlipList className="web-tabs" keys={item.tabIds} label={item.name}>
            {item.tabIds.map((id) => row(id, true))}
          </FlipList>
        </div>
      </Collapse>
    </section>
  );
  const needle = query.trim().toLowerCase();
  const hits = needle === '' ? []
    : state.tabs.filter((tab) => `${tab.title} ${tab.url}`.toLowerCase().includes(needle));
  const marked = needle === '' ? [] : bookmarks.filter((bookmark) => `${bookmarkTitle(bookmark)} ${bookmark.target}`
    .toLowerCase().includes(needle));
  const gone = needle === '' ? [] : state.archived.filter((entry) => `${entry.title} ${entry.url}`.toLowerCase()
    .includes(needle)).slice(0, 20);
  // 11-13：查找框一次搜标签、书签和历史；已经作为标签、书签列出来的网址不在历史里再列一遍。
  const listed = new Set([...hits.map((tab) => tab.url), ...marked.map((bookmark) => bookmark.target),
    ...gone.map((entry) => entry.url)]);
  const visited = needle === '' || history === null ? []
    : history.search(needle, HISTORY_HITS + listed.size).filter((visit) => !listed.has(visit.url))
      .slice(0, HISTORY_HITS);
  const fold = (id: string): { collapsed: boolean; onToggle: () => void } => ({ collapsed: folded.includes(id),
    onToggle: () => shellPrefs.setColumnCollapsed(id, !folded.includes(id)) });
  return (
    <div ref={root} className="web-column" data-dragging={drag.dragging !== null}>
      <div className="web-search">
        <label className="web-search-field">
          <Icon name="search" size={14} />
          <input type="search" placeholder="搜标签、书签、历史" aria-label="搜标签" value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }} />
        </label>
        <ColumnCollapseButton />
      </div>
      {needle !== '' ? (
        <div className="column-scroll">
          {hits.length + marked.length + gone.length + visited.length === 0
            ? <p className="column-note">没找到</p> : null}
          <ul className="web-tabs">{hits.map((tab) => row(tab.id, false))}</ul>
          {marked.length === 0 ? null : <>
            <ColumnLabel>书签</ColumnLabel>
            <ul className="web-bookmarks-list" aria-label="书签">
              {marked.map((bookmark) => (
                <li key={bookmark.id} className="web-bookmark-item">
                  <BookmarkButton bookmark={bookmark} tab={openTabFor(state.tabs, bookmark.target)}
                    onOpen={() => openBookmark(bookmark)} />
                </li>
              ))}
            </ul>
          </>}
          {gone.length === 0 ? null : <>
            <ColumnLabel>关掉的</ColumnLabel>
            <ul className="web-tabs">
              {gone.map((entry) => (
                <li key={entry.key} className="web-tab-item">
                  <button type="button" className="web-tab-row" onClick={() => props.onReopen(entry)}>
                    <SiteIcon url={entry.url} title={entry.title} />
                    <span className="web-tab-title">{tabTitle(entry)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>}
          {visited.length === 0 ? null : <>
            <ColumnLabel>历史</ColumnLabel>
            <ul className="web-tabs" aria-label="历史">
              {visited.map((visit) => (
                <li key={visit.url} className="web-tab-item">
                  <button type="button" className="web-tab-row" title={visit.url}
                    onClick={() => tabActions.openWeb(visit.url, visit.title)}>
                    <SiteIcon url={visit.url} title={visit.title} />
                    <span className="web-tab-title">{tabTitle(visit)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>}
        </div>
      ) : (
        <div className="column-scroll">
          <WebBookmarks />
          {state.pinned.length === 0 && drag.dragging === null ? null : (
            <ul className="web-pins" data-drop-pins="" aria-label="置顶"
              data-drop-zone={drag.target?.zone === 'pins'}>
              {state.pinned.map((id) => {
                const tab = byId.get(id);
                if (tab === undefined) return null;
                return (
                  <li key={id} data-pin-id={id}>
                    <button type="button" className="web-pin" aria-current={props.currentId === id ? 'page' : undefined}
                      aria-label={`置顶 ${tabTitle(tab)}`} data-tip={tabTitle(tab)} onClick={() => open(id)}
                      onContextMenu={(event) => contextMenu(event, { kind: 'tab', id })}>
                      <SiteIcon url={tab.url} title={tab.title} tabId={tab.id} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {state.groups.length === 0 ? null : <>
            <WebSectionHead id="web-groups-head" title="分组" count={state.groups.length} controls="web-groups-body"
              {...fold(FOLD_GROUPS)} />
            <Collapse open={!folded.includes(FOLD_GROUPS)} id="web-groups-body">{state.groups.map(group)}</Collapse>
          </>}
          <WebSectionHead id="web-today-head" title="今天" count={state.today.length} controls="web-today-body"
            {...fold(FOLD_TODAY)} />
          <Collapse open={!folded.includes(FOLD_TODAY)} id="web-today-body">
            <div data-drop-list="today" className="web-today">
              <FlipList className="web-tabs" keys={state.today} label="今天">
                {state.today.map((id) => row(id, false))}
              </FlipList>
            </div>
          </Collapse>
        </div>
      )}
      {drag.target?.lineTop == null ? null
        : <span className="web-drop-line" style={{ top: drag.target.lineTop }} aria-hidden="true" />}
      <ColumnFoot>
        <button type="button" className="column-item web-new" onClick={props.onNew}>
          <span className="column-item-lead"><Icon name="plus" size={14} /></span>
          <span className="column-item-text">新标签</span>
        </button>
      </ColumnFoot>
      {menu?.kind === 'tab' ? <TabMenu tabs={webTabs} tabId={menu.id} anchor={menu.anchor}
        onClose={() => setMenu(null)} onCloseTab={props.onClose}
        onNewGroup={(groupId) => setMenu({ kind: 'group', id: groupId, anchor: menu.anchor })} /> : null}
      {menu?.kind === 'group' ? <GroupMenu tabs={webTabs} groupId={menu.id} anchor={menu.anchor}
        onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
