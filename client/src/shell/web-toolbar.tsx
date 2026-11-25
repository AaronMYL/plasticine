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
  title: string;
  native: NativeWebTabs | null;
  leading: ReactNode;
  open: WebPopoverKind | null;
  onToggle: (kind: WebPopoverKind, element: HTMLElement) => void;
  circling: boolean;
  onCircle: () => void;
  onBookmarkError: (text: string) => void;
  onExtract?: () => void;
  extracting?: boolean;
  historyInMenu?: boolean;
}

export function WebToolbar(props: WebToolbarProps): ReactNode {
  const { tab, url, native } = props;
  const nav = native?.nav[tab.id];
  const viaMore = props.historyInMenu === true && props.open === 'history';
  const pressed = (kind: WebPopoverKind): Record<string, boolean | string> => ({
    'aria-expanded': props.open === kind || (kind === 'more' && viaMore),
    'data-active': props.open === kind || (kind === 'more' && viaMore),
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
      {props.onExtract === undefined ? null : <IconButton icon="edit" className="web-extract-toggle" label="提取"
        aria-pressed={props.extracting ?? false} data-active={props.extracting ?? false} onClick={props.onExtract} />}
      {native === null || props.historyInMenu === true ? null : <IconButton icon="history"
        className="web-history-toggle"
        label="历史记录" title="历史记录 · ⌘Y" {...pressed('history')}
        onClick={(event) => props.onToggle('history', event.currentTarget)} />}
      <IconButton icon="more" className="web-more" label="更多" {...pressed('more')}
        onClick={(event) => props.onToggle('more', event.currentTarget)} />
      {nav?.loading === true ? <span className="web-loading" role="progressbar" aria-label="正在载入" /> : null}
    </div>
  );
}
