// 网页标签（2026-11-02 第 102 条）：在 Mac 原生壳和 iPhone App（0.2.0 起，第 114 条）里真开——前端画工具条，工具条
// 下面那一块由原生 WKWebView 画。这里量出那一块的位置和大小交给原生层（窗口大小、侧栏开合都会变）。网页版、手机浏览器
// 里外链照旧跳出去，这里给一个「在浏览器打开」。
// 2026-11-03（Mac 0.3.0，用户定）：原生网页垫在主网页下面，那一块主网页透明；悬浮对话框和圆球照常盖在网页上，
// 它们占的矩形报成 hitRegions（hit-regions.ts），不再让出一侧。
// 2026-11-04 第 2 批「浏览器」：工具条在 web-toolbar.tsx；这里管弹层（⋯、历史记录、手机 ⋯ 里的书签，一次只开一个）、
// 查找条、阅读模式（原生网页先藏起来）、工具条下面那一句（web-page-actions.ts），以及 ⌘F / ⌘P / ⌘Y（键盘在原生网页
// 里时由原生菜单经 __plasticineWebMenu 交过来）。11-07 两层侧栏：标签在第二栏竖排，书签和分组的弹层没了。
// 第 8 批第 1 条（11-09）：「收进置顶或分组」的弹层去掉（地址框里换成书签按钮）；手机 ⋯ 里的「书签」开同一份书签。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { WEB_MENU_COMMANDS, type WebMenuCommand } from '../api/shared.ts';
import type { WebTab } from '../state/web-tabs.ts';
import './web-toolbar.css';
import { AiMark } from './glyph.tsx';
import { Icon } from './icons.tsx';
import { IconButton } from './icon-button.tsx';
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
import { useWebPageActions, type WebPageActions } from './web-page-actions.ts';
import { WebReader } from './web-reader.tsx';
import { WebToolbar, type WebPopoverKind } from './web-toolbar.tsx';

/** 按下它的那个按钮把弹层关掉之后，紧接着的那一下点击当成「关掉」，不再打开（毫秒）。 */
const REOPEN_GUARD_MS = 300;
/** 工具条上开弹层的按钮带这个属性（值是哪个弹层）。 */
export const TOGGLE_ATTRIBUTE = 'data-web-toggle';

/** 量出原生网页该画在哪：这一块的位置大小一变（窗口、侧栏）就报一次，离开时报 null。 */
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
    // 换页的淡入（往上升 4px）、侧栏开合都是只挪位置不改大小：ResizeObserver 看不见，按帧再量（没变不报）。
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

/** 手机 ⋯ 里点开的书签也是一个弹层（没有自己的按钮）。 */
type Open = { kind: WebPopoverKind | 'bookmarks'; anchor: PopoverAnchor } | null;

/** 一次只开一个弹层；点着开着的那个按钮是关掉。 */
function usePopoverToggle(): { open: Open; setOpen: (open: Open) => void; toggle: (kind: WebPopoverKind,
  element: HTMLElement) => void; close: () => void } {
  const [open, setOpenState] = useState<Open>(null);
  const closedAt = useRef<{ kind: NonNullable<Open>['kind']; at: number } | null>(null);
  const pressed = useRef<EventTarget | null>(null);
  const current = useRef(open);
  current.current = open;
  // 弹层在按下时（捕获阶段）就因为「点了外面」关掉，接着的点击落在同一个按钮上又会打开：记下按的是哪个按钮。
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

function NoticeRow({ actions, web }: { actions: WebPageActions; web: WebChrome | null }): ReactNode {
  const notice = actions.notice;
  if (notice === null) {
    return null;
  }
  return (
    <div className="web-notice" role={notice.kind === 'error' ? 'alert' : 'status'} data-kind={notice.kind}>
      <span className="web-notice-text">{notice.text}</span>
      {notice.kind === 'saved' && web !== null ? (
        <button type="button" className="chip-button" onClick={() => {
          actions.dismiss();
          web.openNote(notice.noteId);
        }}>打开</button>
      ) : null}
      {notice.kind === 'busy' ? null
        : <IconButton icon="close" label="知道了" onClick={actions.dismiss} />}
    </div>
  );
}

export interface WebTabViewProps {
  tab: WebTab;
  native: NativeWebTabs | null;
  phone?: boolean;
  /** 圈一块、截图交给对话框、存进笔记后打开（web-chrome.ts）。 */
  web?: WebChrome | null;
  /** 现在几点（历史记录按天分）；测试给固定的。 */
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
    const button = document.querySelector('.web-tab .web-more');
    return button === null ? { left: window.innerWidth - 24, top: 44, right: window.innerWidth - 24, bottom: 44 }
      : anchorOf(button);
  };
  /** 做一样菜单命令；这里做不了（原生没这一样）回 false，⌘ 键交还给系统。 */
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
    : <Icon name={url.startsWith('https://') ? 'lock' : 'globe'} size={13} />;
  const showBookmarks = (anchor: PopoverAnchor): void => popovers.setOpen({ kind: 'bookmarks', anchor });
  const open = popovers.open;
  const openKind = open === null || open.kind === 'bookmarks' ? null : open.kind;
  return (
    <div className="web-tab" aria-label={`网页：${tab.title}`}>
      <WebToolbar tab={tab} url={url} title={title} native={native} leading={leading} open={openKind}
        onToggle={popovers.toggle} circling={actions.circling} onCircle={actions.circle}
        onBookmarkError={actions.report} />
      {/* 查找条和那一句浮在网页右上角，不把网页往下推（不跳布局）；盖在原生网页上，报成 hitRegions。 */}
      {(finding && native !== null) || actions.notice !== null ? (
        <div className="web-floats" data-phone={phone} {...{ [HIT_REGION_ATTRIBUTE]: 'web-floats' }}>
          {finding && native !== null ? <WebFindBar tabId={tab.id} native={native} onClose={() => setFinding(false)} />
            : null}
          <NoticeRow actions={actions} web={web} />
        </div>
      ) : null}
      <div className="web-frame" ref={frameRef}>
        {native === null ? (
          <p className="banner web-note">
            <span className="banner-text">网页在桌面客户端里打开；这里在新窗口打开。</span>
            <button type="button" className="chip-button" onClick={openOutside}>在新窗口打开</button>
          </p>
        ) : reading ? <WebReader tabId={tab.id} url={url} onExit={() => setReading(false)} /> : null}
      </div>
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
          onHistory={(anchor) => popovers.setOpen({ kind: 'history', anchor })}
          {...(phone ? { onBookmarks: showBookmarks } : {})}
          {...(hostLogins() === null ? {} : { onImportLogins: openLoginImport })}
          {...(phone ? { onCircle: actions.circle } : {})} />
      ) : null}
    </div>
  );
}
