import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { WEB_MENU_COMMANDS, type WebMenuCommand } from '../api/shared.ts';
import type { WebTab } from '../state/web-tabs.ts';
import './web-toolbar.css';
import { AiMark } from './glyph.tsx';
import { Icon } from './icons.tsx';
import { HIT_REGION_ATTRIBUTE } from './hit-regions.ts';
import { anchorOf, type PopoverAnchor } from './popover.tsx';
import type { NativeWebTabs } from './use-native-web-tabs.ts';
import type { WebChrome } from './web-chrome.ts';
import { WebBookmarksPopover } from './web-bookmarks-popover.tsx';
import { WebFindBar } from './web-find-bar.tsx';
import { WebHistoryPopover } from './web-history-popover.tsx';
import { WebMoreMenu } from './web-more-menu.tsx';
import { hostLogins } from './host.ts';
import { openLoginImport } from '../views/settings/login-import-request.ts';
import { useWebPageActions } from './web-page-actions.ts';
import { useWebExtract } from './use-web-extract.ts';
import { WebExtractPanel } from './web-extract-panel.tsx';
import './web-extract.css';
import { WebReader } from './web-reader.tsx';
import { WebToolbar, type WebPopoverKind } from './web-toolbar.tsx';

const REOPEN_GUARD_MS = 300;
export const TOGGLE_ATTRIBUTE = 'data-web-toggle';

function useFrameReport(setFrame: NativeWebTabs['setFrame'] | null): RefObject<HTMLDivElement | null> {
  const element = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const target = element.current;
    if (setFrame === null || target === null) {
      return undefined;
    }
    const report = (): void => {
      const rect = target.getBoundingClientRect();
      setFrame({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(target);
    window.addEventListener('resize', report);
    let handle = 0;
    const loop = (): void => {
      report();
      handle = window.requestAnimationFrame(loop);
    };
    if (typeof window.requestAnimationFrame === 'function') {
      handle = window.requestAnimationFrame(loop);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', report);
      if (handle !== 0) {
        window.cancelAnimationFrame(handle);
      }
      setFrame(null);
    };
  }, [setFrame]);
  return element;
}

type Open = { kind: WebPopoverKind | 'bookmarks'; anchor: PopoverAnchor } | null;

function usePopoverToggle(): { open: Open; setOpen: (open: Open) => void; toggle: (kind: WebPopoverKind,
  element: HTMLElement) => void; close: () => void } {
  const [open, setOpenState] = useState<Open>(null);
  const closedAt = useRef<{ kind: NonNullable<Open>['kind']; at: number } | null>(null);
  const pressed = useRef<EventTarget | null>(null);
  const current = useRef(open);
  current.current = open;
  useEffect(() => {
    const down = (event: PointerEvent): void => {
      pressed.current = event.target;
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
  const close = (): void => {
    const kind = current.current?.kind;
    const target = pressed.current instanceof Element ? pressed.current.closest(`[${TOGGLE_ATTRIBUTE}]`) : null;
    if (kind !== undefined && target?.getAttribute(TOGGLE_ATTRIBUTE) === kind) {
      closedAt.current = { kind, at: performance.now() };
    }
    pressed.current = null;
    setOpenState(null);
  };
  const toggle = (kind: WebPopoverKind, element: HTMLElement): void => {
    if (current.current?.kind === kind) {
      close();
      return;
    }
    const last = closedAt.current;
    if (last !== null && last.kind === kind && performance.now() - last.at < REOPEN_GUARD_MS) {
      return;
    }
    setOpenState({ kind, anchor: anchorOf(element) });
  };
  return { open, setOpen: setOpenState, toggle, close };
}

export interface WebTabViewProps {
  tab: WebTab;
  native: NativeWebTabs | null;
  phone?: boolean;
  web?: WebChrome | null;
  now?: () => Date;
}

export function WebTabView(props: WebTabViewProps): ReactNode {
  const { tab, native, phone = false, web = null } = props;
  const now = props.now ?? (() => new Date());
  const popovers = usePopoverToggle();
  const [finding, setFinding] = useState(false);
  const [reading, setReading] = useState(false);
  const nav = native?.nav[tab.id];
  const url = nav?.url === undefined || nav.url === '' ? tab.url : nav.url;
  const title = nav?.title === undefined || nav.title === '' ? tab.title : nav.title;
  const extract = useWebExtract(tab.id, url, native);
  const actions = useWebPageActions({ tabId: tab.id, url, title }, native, web);
  const frameRef = useFrameReport(reading ? null : native?.setFrame ?? null);
  const openOutside = (): void => {
    if (native !== null) {
      native.command(tab.id, 'open_external');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const moreButton = (): PopoverAnchor => {
    const button = document.querySelector('.web-tab .web-history-toggle')
      ?? document.querySelector('.web-tab .web-more');
    return button === null ? { left: window.innerWidth - 24, top: 44, right: window.innerWidth - 24, bottom: 44 }
      : anchorOf(button);
  };
  const menu = (command: WebMenuCommand): boolean => {
    if (command === 'find' && native?.tools.has('find') === true) {
      setReading(false);
      setFinding(true);
      return true;
    }
    if (command === 'print' && native?.tools.has('print') === true) {
      actions.print();
      return true;
    }
    if (command === 'history' && native !== null) {
      popovers.setOpen({ kind: 'history', anchor: moreButton() });
      return true;
    }
    return false;
  };
  const menuRef = useRef(menu);
  menuRef.current = menu;
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey
        || event.shiftKey) {
        return;
      }
      const command = ({ KeyF: 'find', KeyP: 'print', KeyY: 'history' } as const)[event.code as 'KeyF'];
      if (command !== undefined && menuRef.current(command)) {
        event.preventDefault();
      }
    };
    const fromNative = (command: unknown): void => {
      const known = WEB_MENU_COMMANDS.find((name) => name === command);
      if (known === undefined) {
        console.warn('原生菜单交来的网页命令不认识，没有用', command);
        return;
      }
      menuRef.current(known);
    };
    window.addEventListener('keydown', keys);
    window.__plasticineWebMenu = fromNative;
    return () => {
      window.removeEventListener('keydown', keys);
      if (window.__plasticineWebMenu === fromNative) {
        delete window.__plasticineWebMenu;
      }
    };
  }, []);

  const leading = tab.openedBy === 'plasticine' ? <AiMark label="Plasticine 打开的" />
    : <Icon name={url.startsWith('https://') ? 'lock' : 'globe'} size={14} />;
  const showBookmarks = (anchor: PopoverAnchor): void => popovers.setOpen({ kind: 'bookmarks', anchor });
  const open = popovers.open;
  const openKind = open === null || open.kind === 'bookmarks' ? null : open.kind;
  return (
    <div className="web-tab" aria-label={`网页：${tab.title}`}>
      <WebToolbar tab={tab} url={url} title={title} native={native} leading={leading} open={openKind}
        onToggle={popovers.toggle} circling={actions.circling} onCircle={actions.circle}
        onBookmarkError={actions.report} historyInMenu={phone}
        {...(native?.tools.has('extract_marks') !== true || !native.tools.has('extract_images') ? {} : {
          onExtract: () => {
            setReading(false);
            extract.toggle();
          }, extracting: extract.open })} />
      {finding && native !== null ? (
        <div className="web-floats" data-phone={phone} {...{ [HIT_REGION_ATTRIBUTE]: 'web-floats' }}>
          <WebFindBar tabId={tab.id} native={native} onClose={() => setFinding(false)} />
        </div>
      ) : null}
      <div className="web-content"><div className="web-frame" ref={frameRef}>
        {native === null ? (
          <p className="banner web-note">
            <span className="banner-text">网页在桌面客户端里打开；这里在新窗口打开。</span>
            <button type="button" className="chip-button" onClick={openOutside}>在新窗口打开</button>
          </p>
        ) : reading ? <WebReader tabId={tab.id} url={url} onExit={() => setReading(false)} /> : null}
      </div>
      <WebExtractPanel extract={extract} /></div>
      {open?.kind === 'bookmarks' ? <WebBookmarksPopover anchor={open.anchor} onClose={popovers.close} /> : null}
      {open?.kind === 'history' && native !== null ? (
        <WebHistoryPopover anchor={open.anchor} history={native.history} now={now} onClose={popovers.close}
          onOpen={(visit) => native.navigate(tab.id, visit.url)} />
      ) : null}
      {open?.kind === 'more' ? (
        <WebMoreMenu anchor={open.anchor} phone={phone} native={native !== null}
          tools={native?.tools ?? new Set()} zoom={native?.zoomOf(tab.id) ?? 1} reading={reading}
          onClose={popovers.close}
          onFind={() => { menu('find'); }}
          onZoom={(factor) => native?.setZoom(tab.id, factor)}
          onReading={() => {
            setFinding(false);
            setReading(!reading);
          }}
          onCapture={actions.capture} onClip={actions.clip} onPrint={actions.print} onCopyLink={actions.copyLink}
          onOpenOutside={openOutside} onDownloads={actions.downloads}
          {...(phone ? { onHistory: (anchor: PopoverAnchor) => popovers.setOpen({ kind: 'history', anchor }) } : {})}
          {...(phone ? { onBookmarks: showBookmarks } : {})}
          {...(hostLogins() === null ? {} : { onImportLogins: openLoginImport })}
          {...(phone ? { onCircle: actions.circle } : {})} />
      ) : null}
    </div>
  );
}
