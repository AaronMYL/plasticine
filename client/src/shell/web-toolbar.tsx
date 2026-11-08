// 网页工具条（11-07 设计稿 Web / Windows-Web）：← → ↻（载入中 ↻ 变 ✕）· 圈一块 · 地址框（平时只显示网站名，点了出
// 完整网址可改）· 文A · 收进（置顶或放进分组，和竖排标签的右键菜单同一份）· ⋯。顶上 56 高，和第二栏顶上对齐；
// Windows 的窗口按钮在右上角时右边让出它们的宽度（壳告诉界面）。圈一块只放图标，悬停写「圈一块」；圈的时候按钮按下着，
// 再点一下取消。要原生做的按钮（前进后退刷新、圈一块、文A）没有原生网页标签时不出。

import type { ReactNode } from 'react';
import type { WebTab } from '../state/web-tabs.ts';
import { IconButton } from './icon-button.tsx';
import { TranslateButton } from './translate-button.tsx';
import type { NativeWebTabs } from './use-native-web-tabs.ts';
import { WebAddress } from './web-address-field.tsx';

export type WebPopoverKind = 'keep' | 'more' | 'history';

export interface WebToolbarProps {
  tab: WebTab;
  url: string;
  native: NativeWebTabs | null;
  leading: ReactNode;
  /** 哪个弹层开着（它的按钮铺底）。 */
  open: WebPopoverKind | null;
  onToggle: (kind: WebPopoverKind, element: HTMLElement) => void;
  circling: boolean;
  onCircle: () => void;
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
    <div className="web-bar web-toolbar" data-tip-side="bottom" data-titlebar="">
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
      <WebAddress tab={tab} url={url} native={native} leading={props.leading} />
      {native === null ? null : <TranslateButton tabId={tab.id} url={url} />}
      <IconButton icon="bookmark" className="web-keep-button" label="收进置顶或分组" title="置顶、放进分组"
        {...pressed('keep')} onClick={(event) => props.onToggle('keep', event.currentTarget)} />
      <IconButton icon="more" className="web-more" label="更多" {...pressed('more')}
        onClick={(event) => props.onToggle('more', event.currentTarget)} />
    </div>
  );
}
