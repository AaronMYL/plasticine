// 竖排标签的右键菜单：置顶 / 取消置顶、放进哪一组（或新分组）、放回今天、关掉（11-09 起工具条上不再有「收进…」）；
// 组标题的菜单：改名、换颜色、解散分组（标签回到今天，一个不丢）。

import { useState, type ReactNode } from 'react';
import { PROJECT_HUES } from '../../api/shared.ts';
import { HueSwatches } from '../../primitives/hue-swatches/index.tsx';
import { HUE_NAMES } from '../hue.tsx';
import type { WebTabsStore } from '../../state/web-tabs.ts';
import { placeOf } from '../../state/web-tabs.ts';
import { MenuItem, MenuSeparator, Popover, type PopoverAnchor } from '../popover.tsx';



export function TabMenu({ tabs, tabId, anchor, onClose, onCloseTab, onNewGroup }: { tabs: WebTabsStore;
  tabId: string; anchor: PopoverAnchor; onClose: () => void; onCloseTab: (id: string) => void;
  onNewGroup: (groupId: string) => void }): ReactNode {
  const state = tabs.get();
  const place = placeOf(state, tabId);
  const act = (run: () => void): (() => void) => () => {
    run();
    onClose();
  };
  return (
    <Popover anchor={anchor} role="menu" align="start" label="标签的操作" onClose={onClose}>
      <MenuItem icon="pin" label={place?.list === 'pinned' ? '取消置顶' : '置顶'}
        onSelect={act(() => (place?.list === 'pinned' ? tabs.release(tabId) : tabs.pin(tabId)))} />
      {state.groups.map((group) => (
        <MenuItem key={group.id} icon="folder" label={`放进「${group.name}」`}
          checked={place?.list === 'group' && place.groupId === group.id}
          onSelect={act(() => tabs.move(tabId, { list: 'group', groupId: group.id }, group.tabIds.length))} />
      ))}
      <MenuItem icon="plus" label="放进新分组" onSelect={act(() => onNewGroup(tabs.createGroup([tabId])))} />
      {place?.list === 'today' ? null : <MenuItem icon="back" label="放回今天" onSelect={act(() => tabs.release(tabId))} />}
      <MenuSeparator />
      <MenuItem icon="close" label="关掉" onSelect={act(() => onCloseTab(tabId))} />
    </Popover>
  );
}

export function GroupMenu({ tabs, groupId, anchor, onClose }: { tabs: WebTabsStore; groupId: string;
  anchor: PopoverAnchor; onClose: () => void }): ReactNode {
  const group = tabs.get().groups.find((candidate) => candidate.id === groupId);
  const [name, setName] = useState(group?.name ?? '');
  if (group === undefined) {
    return null;
  }
  return (
    <Popover anchor={anchor} role="dialog" align="start" label={`分组「${group.name}」`} onClose={onClose}
      initialFocus="panel">
      <form className="web-group-rename" onSubmit={(event) => {
        event.preventDefault();
        tabs.renameGroup(groupId, name);
        onClose();
      }}>
        <label className="sr-only" htmlFor="web-group-name">分组名字</label>
        <input id="web-group-name" className="field-input" value={name} autoFocus maxLength={60}
          onChange={(event) => setName(event.target.value)} onBlur={() => tabs.renameGroup(groupId, name)} />
      </form>
      <div className="web-group-hues">
        <HueSwatches label="颜色" hues={PROJECT_HUES} names={HUE_NAMES} value={group.hue}
          onChange={(hue) => tabs.recolorGroup(groupId, hue)} />
      </div>
      <MenuSeparator />
      <MenuItem icon="close" label="解散分组" title="组里的标签回到「今天」" onSelect={() => {
        tabs.ungroup(groupId);
        onClose();
      }} />
    </Popover>
  );
}
