// 网页工具条（11-07 设计稿 Web / Windows-Web）：← → ↻（载入中 ↻ 变 ✕）· 圈一块 · 地址框（平时只显示网站名，点了出
// 完整网址可改；框里右端是书签按钮，第 8 批第 1 条：收藏 / 取消当前网址，原来「收进置顶或分组」那个按钮去掉了，
// 置顶、分组照旧在标签的右键菜单里）· 文A · ⋯。顶上 56 高，和第二栏顶上对齐
// （Windows 的窗口按钮 11-08 起在标题栏里，这里不用让）。圈一块只放图标，悬停写「圈一块」；圈的时候按钮按下着，
// 再点一下取消。要原生做的按钮（前进后退刷新、圈一块、文A）没有原生网页标签时不出。

import type { ReactNode } from 'react';
import type { WebTab } from '../state/web-tabs.ts';
import { BookmarkToggle } from './bookmark-toggle.tsx';
import { IconButton } from './icon-button.tsx';
import { TranslateButton } from './translate-button.tsx';
import type { NativeWebTabs } from './use-native-web-tabs.ts';
import { WebAddress } from './web-address-field.tsx';

export type WebPopoverKind = 'more' | 'history';

export interface WebToolbarProps {
  tab: WebTab;
  url: string;
  /** 现在这一页的标题（加书签用）。 */
  title: string;
  native: NativeWebTabs | null;
  leading: ReactNode;
  /** 哪个弹层开着（它的按钮铺底）。 */
  open: WebPopoverKind | null;
  onToggle: (kind: WebPopoverKind, element: HTMLElement) => void;
  circling: boolean;
  onCircle: () => void;
  /** 书签按钮没成：工具条下面说一句。 */
  onBookmarkError: (text: string) => void;
}

export function WebToolbar(props: WebToolbarProps): ReactNode {
  const { tab, url, native } = props;
  const nav = native?.nav[tab.id];
  const pressed = (kind: WebPopoverKind): Record<string, boolean | string> => ({
    'aria-expanded': props.open === kind || (kind === 'more' && props.open === 'history'),
    'data-active': props.open === kind || (kind === 'more' && props.open === 'history'),
    'data-web-toggle': kind,
  });
  return (
    <div className="web-bar web-toolbar" data-tip-side="bottom">
      {native === null ? null : (
        <span className="web-nav" role="group" aria-label="前进后退">
          <IconButton icon="back" label="后退" disabled={nav?.canGoBack !== true}
            onClick={() => native.command(tab.id, 'back')} />
          <IconButton icon="forward" label="前进" disabled={nav?.canGoForward !== true}
            onClick={() => native.command(tab.id, 'forward')} />
          {nav?.loading === true
            ? <IconButton icon="close" label="停止载入" onClick={() => native.command(tab.id, 'stop')} />
            : <IconButton icon="refresh" label="重新载入" title="重新载入 · ⌘R"
              onClick={() => native.command(tab.id, 'reload')} />}
        </span>
      )}
      {native?.tools.has('circle') === true ? (
        <IconButton icon="region" className="web-circle" label="圈一块" aria-pressed={props.circling}
          data-active={props.circling} onClick={props.onCircle} />
      ) : null}
      <WebAddress tab={tab} url={url} native={native} leading={props.leading}
        trailing={<BookmarkToggle url={url} title={props.title} onError={props.onBookmarkError} />} />
      {native === null ? null : <TranslateButton tabId={tab.id} url={url} />}
      <IconButton icon="more" className="web-more" label="更多" {...pressed('more')}
        onClick={(event) => props.onToggle('more', event.currentTarget)} />
    </div>
  );
}
