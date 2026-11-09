// 网页栏的「书签」一节（第 8 批第 1 条，11-09 他定「书签是书签，标签页是标签页」，设计稿 Bookmarks / Bookmark-Menu /
// Bookmark-Undo）：在搜标签下面、置顶上面，下面一道细线。标题「书签」带箭头，点了整节收起（高度动画，记在本机）。
// 一行：网站图标 + 名字；已经有标签开着同一个网址的，行尾一个小灰点。点一下：开着就切过去，否则新开一个标签（进
// 「今天」）并切过去；书签本身永远不变。右键：在新标签打开 / 改名（原处改）/ 删除（不确认，原处一行「撤销」）。
// 能拖动排序。没有网页书签时整节（连细线）不出。

import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import type { WebTab } from '../../state/web-tabs.ts';
import {
  bookmarkTitle,
  openBookmark,
  openTabFor,
  webBookmarks,
  type WebBookmark,
} from '../../views/bookmarks/bookmark-address.ts';
import { Collapse } from '../collapse.tsx';
import { FlipList } from '../flip-list.tsx';
import { Icon } from '../icons.tsx';
import { anchorOf, MenuItem, MenuSeparator, pointAnchor, Popover, type PopoverAnchor } from '../popover.tsx';
import { RenameField } from '../rename-field.tsx';
import { SiteIcon } from '../site-icon.tsx';
import { useTabActions } from '../tabs-context.ts';
import { BOOKMARK_ROW_ATTRIBUTE, useBookmarkDrag } from './bookmark-drag.ts';
import { GONE_ATTRIBUTE, useBookmarkUndo, type GoneBookmark } from './bookmark-undo.ts';
import './web-bookmarks.css';

const LIST_ID = 'web-bookmarks-list';

/** 点书签：壳的打开网页（桌面客户端开成竖排标签，网页版、手机在新窗口打开）。 */
export function useOpenBookmark(): (bookmark: WebBookmark) => void {
  const { webTabs } = useClientState();
  const actions = useTabActions();
  return (bookmark) => openBookmark(webTabs, actions.openWeb, bookmark);
}

export interface BookmarkButtonProps {
  bookmark: WebBookmark;
  /** 开着同一个网址的标签（行尾小点；图标先用桌面壳报来的）。 */
  tab: WebTab | null;
  onOpen: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/** 一行书签：网站图标 + 名字 + 开着的小点（读屏念「，已开着」）。网页栏、搜标签、手机的书签列表都用它。 */
export function BookmarkButton({ bookmark, tab, onOpen, onContextMenu }: BookmarkButtonProps): ReactNode {
  const title = bookmarkTitle(bookmark);
  return (
    <button type="button" className="web-bookmark-row" onClick={onOpen} onContextMenu={onContextMenu}>
      <SiteIcon url={bookmark.target} title={title} tabId={tab?.id} />
      <span className="web-bookmark-title">{title}</span>
      {tab === null ? null : <>
        <span className="web-bookmark-open" aria-hidden="true" data-tip="已开着" />
        <span className="sr-only">，已开着</span>
      </>}
    </button>
  );
}

function GoneRow({ gone, onUndo }: { gone: GoneBookmark; onUndo: () => void }): ReactNode {
  const title = bookmarkTitle(gone.view);
  return (
    <li className="web-bookmark-item web-bookmark-gone" {...{ [GONE_ATTRIBUTE]: '' }}
      role={gone.error === null ? 'status' : 'alert'} data-error={gone.error !== null}>
      <span className="web-bookmark-gone-text">
        {gone.error === null ? `已删除「${title}」` : `「${title}」${gone.error}`}
      </span>
      {gone.error === null ? (
        <button type="button" className="web-bookmark-undo" onClick={onUndo}>
          <Icon name="undo" size={14} />
          <span>撤销</span>
        </button>
      ) : null}
    </li>
  );
}

interface BookmarkMenuProps {
  anchor: PopoverAnchor;
  /** 键盘打开的（菜单键）：焦点进第一项；鼠标右键打开的焦点在菜单本身，方向键接着能用。 */
  keyboard: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function BookmarkMenu({ anchor, keyboard, onOpen, onRename, onDelete, onClose }: BookmarkMenuProps): ReactNode {
  const act = (run: () => void) => (): void => {
    onClose();
    run();
  };
  return (
    <Popover anchor={anchor} role="menu" align="start" label="书签的操作" onClose={onClose}
      initialFocus={keyboard ? 'first' : 'panel'}>
      <MenuItem icon="tab-new" label="在新标签打开" onSelect={act(onOpen)} />
      <MenuItem icon="edit" label="改名" onSelect={act(onRename)} />
      <MenuSeparator />
      <MenuItem icon="trash" label="删除" danger onSelect={act(onDelete)} />
    </Popover>
  );
}

/** 拖到第 index 个：新的先后（拖着的那个拿出来再插进去）。 */
function movedIds(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((candidate) => candidate !== id);
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

export function WebBookmarks(): ReactNode {
  const live = useLive();
  const { webTabs, shellPrefs } = useClientState();
  const data = useStore(live.bookmarks.data);
  const tabs = useStore(webTabs.store).tabs;
  const collapsed = useStore(shellPrefs.store).bookmarksCollapsed;
  const open = useOpenBookmark();
  const undo = useBookmarkUndo(live.bookmarks);
  const list = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor; keyboard: boolean } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const all = webBookmarks(data.bookmarks);
  const drag = useBookmarkDrag(list, (id, index) => {
    live.bookmarks.order(movedIds(all.map((bookmark) => bookmark.id), id, index)).catch((cause: unknown) => {
      console.warn('书签的先后没存上，按本体那一份重画', cause);
    });
  });
  const gone = undo.gone;
  const shown = all.filter((bookmark) => bookmark.id !== gone?.view.id);
  if (shown.length === 0 && gone === null) {
    return null;
  }
  const contextMenu = (event: MouseEvent<HTMLElement>, id: string): void => {
    event.preventDefault();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    setMenu({ id, keyboard,
      anchor: keyboard ? anchorOf(event.currentTarget) : pointAnchor(event.clientX, event.clientY) });
  };
  const row = (bookmark: WebBookmark): ReactNode => {
    const tab = openTabFor(tabs, bookmark.target);
    if (renaming === bookmark.id) {
      return (
        <li key={bookmark.id} className="web-bookmark-item web-bookmark-editing"
          {...{ [BOOKMARK_ROW_ATTRIBUTE]: bookmark.id }}>
          <SiteIcon url={bookmark.target} title={bookmark.title} tabId={tab?.id} />
          <RenameField value={bookmark.title} label={`「${bookmark.title}」的新名字`}
            onSave={async (title) => {
              await live.bookmarks.edit(bookmark, { title });
            }} onDone={() => setRenaming(null)} />
        </li>
      );
    }
    return (
      <li key={bookmark.id} className="web-bookmark-item" {...{ [BOOKMARK_ROW_ATTRIBUTE]: bookmark.id }}
        data-dragging={drag.dragging === bookmark.id} data-menu={menu?.id === bookmark.id}
        onPointerDown={(event) => drag.onPointerDown(event, bookmark.id)}>
        <BookmarkButton bookmark={bookmark} tab={tab} onContextMenu={(event) => contextMenu(event, bookmark.id)}
          onOpen={() => {
            if (!drag.swallowClick()) open(bookmark);
          }} />
      </li>
    );
  };
  // 撤销那一行插在删之前的位置；FlipList 按画出来的先后认行，键也一起插。
  const rows = shown.map(row);
  const keys = shown.map((bookmark) => bookmark.id);
  if (gone !== null) {
    const at = Math.min(gone.index, rows.length);
    rows.splice(at, 0, <GoneRow key={`gone:${gone.view.id}`} gone={gone} onUndo={undo.undo} />);
    keys.splice(at, 0, `gone:${gone.view.id}`);
  }
  const target = menu === null ? undefined : all.find((bookmark) => bookmark.id === menu.id);
  return (
    <>
      <section className="web-bookmarks" aria-labelledby="web-bookmarks-head" data-dragging={drag.dragging !== null}>
        <button type="button" id="web-bookmarks-head" className="web-bookmarks-head" aria-expanded={!collapsed}
          aria-controls={LIST_ID} onClick={() => shellPrefs.setBookmarksCollapsed(!collapsed)}>
          <span>书签</span>
          <span className="web-bookmarks-chevron" aria-hidden="true"><Icon name="chevron-down" size={12} /></span>
        </button>
        <Collapse open={!collapsed} id={LIST_ID}>
          <div ref={list} className="web-bookmarks-body">
            <FlipList className="web-bookmarks-list" keys={keys} label="书签">
              {rows}
            </FlipList>
            {drag.drop === null ? null
              : <span className="web-drop-line" style={{ top: drag.drop.lineTop }} aria-hidden="true" />}
          </div>
        </Collapse>
      </section>
      <hr className="web-bookmarks-rule" />
      {menu !== null && target !== undefined ? (
        <BookmarkMenu anchor={menu.anchor} keyboard={menu.keyboard} onClose={() => setMenu(null)}
          onOpen={() => open(target)}
          onRename={() => setRenaming(target.id)}
          onDelete={() => undo.remove(target, shown.findIndex((bookmark) => bookmark.id === target.id))} />
      ) : null}
    </>
  );
}
