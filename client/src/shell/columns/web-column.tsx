// 网页栏目的第二栏：竖排标签（《优化清单》第 2 条，11-07 设计稿 Web；参考 Arc、Edge）。从上到下：搜标签、置顶（一排
// 图标，四个一行）、分组（组标题点了整组收起展开，有高度动画）、今天打开的；最底下「新标签」。
// 一行：网站首字母小方块 + 标题，当前那一个是 --bg 底加细线、行尾 ×。拖动排序、拖进分组、拖到置顶（web-tab-drag.ts），
// 右键出菜单（web-tab-menu.tsx）。搜标签时下面换成一张平的结果：开着的标签、关掉的（点了重开）。

import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import type { ArchivedTab, WebTab, WebTabGroup } from '../../state/web-tabs.ts';
import { Collapse } from '../collapse.tsx';
import { FlipList } from '../flip-list.tsx';
import { hueVar } from '../hue.tsx';
import { Icon } from '../icons.tsx';
import { pointAnchor, type PopoverAnchor } from '../popover.tsx';
import { SiteIcon } from '../site-icon.tsx';
import { ColumnFoot, ColumnLabel } from './column.tsx';
import { ColumnCollapseButton } from './column-toggle.tsx';
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
  const { webTabs } = useClientState();
  const state = useStore(webTabs.store);
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
  const gone = needle === '' ? [] : state.archived.filter((entry) => `${entry.title} ${entry.url}`.toLowerCase()
    .includes(needle)).slice(0, 20);
  return (
    <div ref={root} className="web-column" data-dragging={drag.dragging !== null}>
      <div className="web-search">
        <label className="web-search-field">
          <Icon name="search" size={14} />
          <input type="search" placeholder="搜标签" aria-label="搜标签" value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }} />
        </label>
        <ColumnCollapseButton />
      </div>
      {needle !== '' ? (
        <div className="column-scroll">
          {hits.length === 0 && gone.length === 0 ? <p className="column-note">没找到</p> : null}
          <ul className="web-tabs">{hits.map((tab) => row(tab.id, false))}</ul>
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
        </div>
      ) : (
        <div className="column-scroll">
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
            <ColumnLabel>分组</ColumnLabel>
            {state.groups.map(group)}
          </>}
          <ColumnLabel>今天</ColumnLabel>
          <div data-drop-list="today" className="web-today">
            <FlipList className="web-tabs" keys={state.today} label="今天">
              {state.today.map((id) => row(id, false))}
            </FlipList>
          </div>
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
