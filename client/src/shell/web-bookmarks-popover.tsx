// 手机网页 ⋯ 顶上一排的「书签」（第 8 批第 1 条）：点开是同一份书签（和网页栏「书签」一节同一份、同一样的行），点一个
// 照手机打开网页的方式打开（开着同一个网址就切过去，否则新开；手机网页在新窗口打开），然后收起。

import type { ReactNode } from 'react';
import { useLive } from '../live.tsx';
import { useClientState } from '../state/context.tsx';
import { useStore } from '../state/use-store.ts';
import { openTabFor, webBookmarks } from '../views/bookmarks/bookmark-address.ts';
import { BookmarkButton, useOpenBookmark } from './columns/web-bookmarks.tsx';
import { Popover, type PopoverAnchor } from './popover.tsx';

export function WebBookmarksPopover({ anchor, onClose }: { anchor: PopoverAnchor; onClose: () => void }): ReactNode {
  const { webTabs } = useClientState();
  const tabs = useStore(webTabs.store).tabs;
  const bookmarks = webBookmarks(useStore(useLive().bookmarks.data).bookmarks);
  const open = useOpenBookmark();
  return (
    <Popover anchor={anchor} role="dialog" align="end" label="书签" className="web-bookmarks-pop" onClose={onClose}
      initialFocus="panel">
      {bookmarks.length === 0 ? <p className="web-bookmarks-pop-empty">还没有书签</p> : (
        <ul className="web-bookmarks-list" aria-label="书签">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id} className="web-bookmark-item">
              <BookmarkButton bookmark={bookmark} tab={openTabFor(tabs, bookmark.target)} onOpen={() => {
                onClose();
                open(bookmark);
              }} />
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
