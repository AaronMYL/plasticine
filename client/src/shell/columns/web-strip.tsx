// 网页栏目收起后的窄栏（11-08 他定，参考图 collapsed.png 只借结构，样子照方向 I）：56 宽，从上到下——展开按钮；
// 搜标签（打开 ⌘K）；置顶的网站图标；每个分组一个图标块（组的颜色，点了在旁边浮出这一组）；一道线；今天的标签只剩
// 网站图标（当前那个 --tint2 底，悬停浮出标题，同一个悬停提示层）；最下面「+」新标签。拖动排序照样能用
// （web-tab-drag.ts，同一套落点），右键出同一份菜单。

import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import type { WebTab, WebTabGroup } from '../../state/web-tabs.ts';
import { FlipList } from '../flip-list.tsx';
import { HueTile } from '../hue.tsx';
import { IconButton } from '../icon-button.tsx';
import { Icon } from '../icons.tsx';
import { Popover, pointAnchor, type PopoverAnchor } from '../popover.tsx';
import { SiteIcon } from '../site-icon.tsx';
import { ColumnExpandButton } from './column-toggle.tsx';
import { useTabDrag } from './web-tab-drag.ts';
import { GroupMenu, TabMenu } from './web-tab-menu.tsx';
import './web-strip.css';

function titleOf(tab: Pick<WebTab, 'title' | 'url'>): string {
  return tab.title.trim() === '' ? tab.url : tab.title;
}

type Menu = { kind: 'tab' | 'group'; id: string; anchor: PopoverAnchor };

export interface WebStripProps {
  currentId: string | null;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** 搜标签：打开 ⌘K。 */
  onSearch: () => void;
}

/** 浮在图标块右边：贴着它的右边、和它顶对齐。 */
function besideOf(element: Element): PopoverAnchor {
  const rect = element.getBoundingClientRect();
  return pointAnchor(rect.right + 8, rect.top - 4);
}

export function WebStrip(props: WebStripProps): ReactNode {
  const { webTabs } = useClientState();
  const state = useStore(webTabs.store);
  const root = useRef<HTMLDivElement>(null);
  const drag = useTabDrag(root, webTabs);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [opened, setOpened] = useState<{ id: string; anchor: PopoverAnchor } | null>(null);
  const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const open = (id: string): void => {
    if (!drag.swallowClick()) props.onOpen(id);
  };
  const contextMenu = (event: MouseEvent, kind: Menu['kind'], id: string): void => {
    event.preventDefault();
    setMenu({ kind, id, anchor: pointAnchor(event.clientX, event.clientY) });
  };
  const tile = (id: string, draggable: boolean): ReactNode => {
    const tab = byId.get(id);
    if (tab === undefined) return null;
    const title = titleOf(tab);
    return (
      <li key={id} data-tab-id={draggable ? id : undefined} data-pin-id={draggable ? undefined : id}
        className="web-strip-item" data-dragging={drag.dragging === id}
        onPointerDown={draggable ? (event) => drag.onPointerDown(event, id) : undefined}
        onContextMenu={(event) => contextMenu(event, 'tab', id)}>
        <button type="button" className="web-strip-tile" aria-label={title} data-tip={title} data-tip-side="right"
          aria-current={props.currentId === id ? 'page' : undefined} onClick={() => open(id)}>
          <SiteIcon url={tab.url} title={tab.title} tabId={tab.id} />
        </button>
      </li>
    );
  };
  const groupTile = (group: WebTabGroup): ReactNode => {
    const holdsCurrent = props.currentId !== null && group.tabIds.includes(props.currentId);
    return (
      <li key={group.id}>
        <button type="button" className="web-strip-tile" data-group-head={group.id}
          data-drop-zone={drag.target?.zone === group.id}
          aria-label={`${group.name}，${group.tabIds.length} 个标签`} data-tip={group.name} data-tip-side="right"
          aria-expanded={opened?.id === group.id} aria-current={holdsCurrent ? 'true' : undefined}
          onClick={(event) => setOpened(opened?.id === group.id ? null
            : { id: group.id, anchor: besideOf(event.currentTarget) })}
          onContextMenu={(event) => contextMenu(event, 'group', group.id)}>
          <HueTile hue={group.hue} icon="tabs" size={22} />
        </button>
      </li>
    );
  };
  const shownGroup = opened === null ? undefined : state.groups.find((group) => group.id === opened.id);
  return (
    <div ref={root} className="web-strip" data-dragging={drag.dragging !== null}>
      <div className="web-strip-head">
        <ColumnExpandButton className="web-strip-tile" tipSide="right" />
      </div>
      <IconButton icon="search" label="搜标签" title="搜标签 ⌘K" className="web-strip-tile" data-tip-side="right"
        onClick={props.onSearch} />
      <div className="web-strip-scroll">
        {state.pinned.length === 0 && drag.dragging === null ? null : (
          <ul className="web-strip-list" data-drop-pins="" aria-label="置顶"
            data-drop-zone={drag.target?.zone === 'pins'}>
            {state.pinned.map((id) => tile(id, false))}
          </ul>
        )}
        {state.groups.length === 0 ? null : (
          <ul className="web-strip-list" aria-label="分组">{state.groups.map(groupTile)}</ul>
        )}
        <span className="web-strip-rule" aria-hidden="true" />
        <div data-drop-list="today" className="web-strip-today">
          <FlipList className="web-strip-list" keys={state.today} label="今天">
            {state.today.map((id) => tile(id, true))}
          </FlipList>
        </div>
        <button type="button" className="web-strip-tile web-strip-new" aria-label="新标签" data-tip="新标签"
          data-tip-side="right" onClick={props.onNew}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      {drag.target?.lineTop == null ? null
        : <span className="web-drop-line web-strip-line" style={{ top: drag.target.lineTop }} aria-hidden="true" />}
      {shownGroup === undefined || opened === null ? null : (
        <Popover anchor={opened.anchor} role="dialog" align="start" label={shownGroup.name}
          className="web-strip-pop" onClose={() => setOpened(null)}>
          <p className="web-strip-pop-title">{shownGroup.name}</p>
          <ul className="web-strip-pop-list">
            {shownGroup.tabIds.map((id) => {
              const tab = byId.get(id);
              if (tab === undefined) return null;
              return (
                <li key={id}>
                  <button type="button" className="web-strip-pop-row"
                    aria-current={props.currentId === id ? 'page' : undefined}
                    onClick={() => {
                      setOpened(null);
                      props.onOpen(id);
                    }}
                    onContextMenu={(event) => contextMenu(event, 'tab', id)}>
                    <SiteIcon url={tab.url} title={tab.title} tabId={tab.id} />
                    <span className="web-strip-pop-text">{titleOf(tab)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover>
      )}
      {menu?.kind === 'tab' ? <TabMenu tabs={webTabs} tabId={menu.id} anchor={menu.anchor}
        onClose={() => setMenu(null)} onCloseTab={props.onClose}
        onNewGroup={(groupId) => setMenu({ kind: 'group', id: groupId, anchor: menu.anchor })} /> : null}
      {menu?.kind === 'group' ? <GroupMenu tabs={webTabs} groupId={menu.id} anchor={menu.anchor}
        onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
