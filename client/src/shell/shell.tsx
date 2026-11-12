// 壳（《优化清单》第 2 条，11-06 定、11-07 设计稿；参考 Muse）：最左一条图标栏（rail.tsx）放顶层入口，点一个入口第二栏
// 换成这个栏目的列表（columns/），主区只放当前打开的那一个东西。只有网页是标签（竖排在网页栏目的第二栏）；Plasticine
// 自己的页面是导航，前进后退走地址（nav-history.ts，⌘[ / ⌘]、鼠标侧键），⌘K 全局切换（views/search/palette.tsx）。
// 对话框不变：右下角浮动对话框跟着当前页，「问这一页」照旧；Plasticine 栏目本身就是对话，那时对话框和圆球不出。
// 手机：当前页全屏 + 底栏（现在 · Plasticine · 消息 · 笔记 · 更多），「更多」是底部抽屉。
// 网页标签在桌面客户端里真开（host.ts 的原生网页标签，use-native-web-tabs.ts）：中间区由原生网页画，垫在主网页下面；
// 网页版里点标签在新窗口打开。主区里的浮层一次只开一个，遮罩只盖主区。壳不含业务：数据都在视图和 state/ 里。

import { MateEditor } from '../views/mates/mate-editor.tsx';
import { currentComposer } from '../views/conversation/current-composer.ts';
import { DockTargetSync } from '../views/mates/dock-target.tsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode }
  from 'react';
import { useLive } from '../live.tsx';
import { useMacCommands } from '../mac/use-mac-commands.ts';
import { useIosAsk } from '../ios/use-ios-ask.ts';
import { Sheet } from '../primitives/sheet/index.tsx';
import { useClientState } from '../state/context.tsx';
import { useRememberedScroll } from '../state/use-remembered-scroll.ts';
import { useStore } from '../state/use-store.ts';
import { webHash } from '../state/web-tabs.ts';
import { useTelemetry } from '../telemetry.ts';
import { BackupRestoreCard } from '../views/device/backup-restore-card.tsx';
import { Palette } from '../views/search/palette.tsx';
import type { PaletteTarget } from '../views/search/palette-results.ts';
import { openBookmark } from '../views/bookmarks/bookmark-address.ts';
import { ToolPanel } from '../views/tools/tool-panel.tsx';
import { BrowserView } from '../views/tools/browser-view.tsx';
import { WorkDetail } from '../views/lines/work-detail.tsx';
import { ChatBall, ChatDialog } from './chat-dialog.tsx';
import { ShellColumn } from './columns/shell-column.tsx';
import { ColumnExpandButton, ColumnToggleContext, type ColumnToggle } from './columns/column-toggle.tsx';
import { CurrentTabContext, type CurrentTab } from './current-tab-context.ts';
import { CurrentView } from './current-view.tsx';
import { hostWebTabs, hostWindowChrome } from './host.ts';
import { IconButton } from './icon-button.tsx';
import { internalPage } from './internal-page.ts';
import { PHONE_BELOW, computeLayout } from './layout.ts';
import { ENTER_KEYFRAMES, MOTION, play } from './motion.ts';
import { goBack, goForward, pushHash, replaceHash } from './nav-history.ts';
import { useExternalLinks } from './open-external.ts';
import { pageIcon } from './page-look.ts';
import { usePageTitle } from './page-title.ts';
import { PanelContext, panelTitle, type Panel } from './panel.ts';
import { MoreDrawer, PhoneBar, phoneFullPage } from './phone-bar.tsx';
import { Rail, type NewKind } from './rail.tsx';
import { HOME, parseHash, routeHash, type Route, type ViewId } from './routes.ts';
import { MainErrorBoundary } from './main-error-boundary.tsx';
import {
  MORE_ITEMS, SECTIONS, hasColumn, sectionOf, type MoreItemId, type PhoneTabId, type SectionId,
} from './sections.ts';
import { useSectionMemory } from './section-memory.ts';
import { TabsContext, type TabActions } from './tabs-context.ts';
import { usePhoneNavigation } from './use-phone-navigation.ts';
import { NativeWebTabsContext, useNativeWebTabs } from './use-native-web-tabs.ts';
import { useRoute } from './use-route.ts';
import { useViewportWidth } from './use-viewport-width.ts';
import { ballWaiting, useWaitingCount } from './waiting.ts';
import { useWebChrome } from './web-chrome.ts';
import { useWebTabsSync } from './use-web-tabs-sync.ts';
import { WebTabView } from './web-tab-view.tsx';
import { WebTranslateProvider } from './web-translate-context.tsx';
import { useWindowChrome } from './window-chrome.ts';
import { Titlebar, TitlebarProvider, useTitlebarState } from './titlebar.tsx';
import { ClientUpdateBanner } from './client-update.tsx';
import { ConnectionBanner } from './connection-banner.tsx';
import { TooltipLayer } from './tooltip.tsx';
import { useAccountFace } from './account-name.ts';
import { useSettingsDialog } from './use-settings-dialog.tsx';
import './shell.css';
import './rail.css';
import './columns/column.css';
import './glyph.css';
import './frame.css';
import './client-update.css';
import { ContextMenuLayer } from './context-menu.tsx';
import { useQuoteCommands } from './use-quote-commands.ts';

type SheetPanel = Exclude<Panel, { kind: 'settings' } | { kind: 'search' }>;

function PanelBody({ panel, navigate }: { panel: SheetPanel; navigate: (route: Route) => void }): ReactNode {
  switch (panel.kind) {
    case 'work': return <WorkDetail {...panel} navigate={navigate} />;
    case 'backup_restore': return <BackupRestoreCard id={panel.id} />;
    case 'tool':
      return <ToolPanel name={panel.name} moneyEntry={panel.moneyEntry} recordId={panel.recordId}
        moneyDate={panel.moneyDate} returnToCalendar={panel.returnToCalendar} />;
  }
}

function linkedWork(route: Route): Extract<Panel, { kind: 'work' }> | null {
  if (route.view !== 'work') return null;
  if (route.lineId != null) return { kind: 'work', lineId: route.lineId };
  if (route.taskId != null) return { kind: 'work', taskId: route.taskId };
  if (route.groupTaskId != null) return { kind: 'work', groupTaskId: route.groupTaskId };
  return { kind: 'work', lineId: '' };
}

/** 换页时整页重来；消息里换一个人不算换页（消息列表的位置和筛选留着）。 */
function boundaryKey(route: Route): string {
  return route.view === 'messages' ? '#/messages' : routeHash(route);
}

/** 换页时新页面淡入、从下方 4px 升上来（180ms）。 */
function PageEnter({ children }: { children: ReactNode }): ReactNode {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    play(element.current, ENTER_KEYFRAMES, MOTION.base);
  }, []);
  return <div ref={element} className="page-enter">{children}</div>;
}

/** 主区开着网页标签时它是哪一个（地址 #/web/<id>）；标签没了是 null。 */
function shownWebId(route: Route): string | null {
  return route.view === 'web' ? route.webTabId ?? null : null;
}

export function Shell(): ReactNode {
  const { route: linked, navigate } = useRoute();
  const width = useViewportWidth();
  const phone = width < PHONE_BELOW;
  const targetState = useClientState();
  const { shellPrefs, webTabs, pageSteps } = targetState;
  const prefs = useStore(shellPrefs.store);
  const webState = useStore(webTabs.store);
  const [webBridge] = useState(hostWebTabs);
  const desktopTabs = webBridge !== null;
  const windowChrome = useWindowChrome();
  const [panel, setPanel] = useState<SheetPanel | null>(null);
  const [newMate, setNewMate] = useState(false);
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);
  const toggleColumnRef = useRef<(() => void) | null>(null);
  // 设置、工作详情盖在当前页上：地址是它们的时候，底下照旧画上一页。
  const lastPage = useRef<Route>(HOME);
  const settings = useSettingsDialog({
    linked,
    phone,
    show: replaceHash,
    tabHash: () => routeHash(lastPage.current),
    beforeOpen: () => {
      setPanel(null);
      setMore(false);
      shellPrefs.setPhoneChatOpen(false);
    },
  });
  const workLink = linkedWork(linked);
  const overlaid = settings.link !== null || workLink !== null;
  if (!overlaid) {
    lastPage.current = linked;
  }
  const route = lastPage.current;
  const section = sectionOf(route);
  const memory = useSectionMemory(route, overlaid);
  // 旧地址（#/conversation…、#/messages/plasticine…、#/bookmarks）规整成新的，不多一步历史。
  // 按地址栏此刻的样子规整（不按这一轮渲染时的：设置弹框会在同一轮里把地址换成它自己的）。
  useEffect(() => {
    const current = window.location.hash;
    const parsed = parseHash(current);
    const normalized = routeHash(parsed);
    if (current !== '' && current !== normalized && parsed.view !== 'settings' && parsed.view !== 'work'
      && parsed.invalidNoteId === undefined) {
      replaceHash(normalized);
    }
  }, [linked]);
  const webId = shownWebId(route);
  const webTab = webId === null ? null : webState.tabs.find((tab) => tab.id === webId) ?? null;
  useEffect(() => {
    if (webId !== null && webState.current !== webId) webTabs.activate(webId);
  }, [webTabs, webId]);
  const live = useLive();
  const connection = useStore(live.hub.status);
  const telemetry = useTelemetry();
  const waiting = useWaitingCount();
  const account = useAccountFace();
  const browserPage = route.view === 'browser' && !phone;
  // 云端浏览器页的「返回」回到进来前的那一页。
  const beforeBrowser = useRef<Route>(HOME);
  if (!browserPage) {
    beforeBrowser.current = route;
  }
  const chatView: ViewId = route.view === 'plasticine' ? 'conversation' : route.view;
  const layout = computeLayout(width, prefs, chatView);
  const activePanel = panel ?? workLink;
  const workFullPage = layout.phone && activePanel?.kind === 'work';
  const main = useRememberedScroll<HTMLElement>(`view:${route.view}`);
  const phoneNavigation = usePhoneNavigation();
  // 桌面客户端最上面一条标题栏（11-08，titlebar.tsx）：有窗口外观桥、不是手机宽度时才有。
  const [hasWindowChrome] = useState(() => hostWindowChrome() !== null);
  const titled = hasWindowChrome && !layout.phone;
  const titlebar = useTitlebarState(titled);

  const go = useCallback((next: Route): void => {
    if (next.view !== lastPage.current.view) {
      telemetry.track('view.switched', { from: lastPage.current.view, to: next.view });
    }
    navigate(next);
    setPanel(null);
    setMore(false);
    shellPrefs.setPhoneChatOpen(false);
  }, [navigate, shellPrefs, telemetry]);
  const showTab = useCallback((id: string | null): void => {
    setPanel(null);
    pushHash(id === null ? routeHash({ view: 'web', noteId: null, webTabId: null }) : webHash(id));
  }, []);
  const focusSection = (target: SectionId): void => {
    if (target === section) {
      const root = SECTIONS[target].root;
      if (target !== 'web' && routeHash(root) !== routeHash(route)) go(root);
      return;
    }
    setPanel(null);
    setMore(false);
    shellPrefs.setPhoneChatOpen(false);
    telemetry.track('view.switched', { from: route.view, to: SECTIONS[target].root.view });
    const current = webState.current;
    pushHash(target === 'web' && desktopTabs && current !== null ? webHash(current) : memory.hashOf(target));
  };
  const expandChat = useCallback((): void => {
    if (layout.phone) {
      setPanel(null);
      shellPrefs.setPhoneChatOpen(true);
    } else {
      shellPrefs.setChatOpen(true);
    }
    telemetry.track('chat.expanded');
  }, [layout.phone, shellPrefs, telemetry]);
  const collapseChat = (): void => {
    if (layout.phone) shellPrefs.setPhoneChatOpen(false);
    else shellPrefs.setChatOpen(false);
    telemetry.track('chat.collapsed');
  };
  const openTabWeb = (id: string): void => {
    const tab = webTabs.tab(id);
    if (tab === null) return;
    if (desktopTabs) {
      showTab(id);
      return;
    }
    // 网页版：网页在新窗口打开，记成今天看过。
    webTabs.activate(id);
    window.open(tab.url, '_blank', 'noopener,noreferrer');
  };
  const closeWebTab = (id: string): void => {
    const shown = webId === id;
    const next = webTabs.close(id);
    if (shown) replaceHash(next === null || !desktopTabs ? '#/web' : webHash(next));
  };
  const tabActions = useMemo<TabActions>(() => ({
    openTab: (next) => go(next),
    openWeb: (url, title, openedBy = 'user') => {
      const internal = internalPage(url);
      if (openedBy === 'user' && internal !== null) {
        go(internal);
        return;
      }
      const id = webTabs.open(url, title, openedBy);
      if (desktopTabs) showTab(id);
      else window.open(url, '_blank', 'noopener,noreferrer');
    },
    reopenTab: (key) => {
      const id = webTabs.reopen(key);
      const tab = id === null ? null : webTabs.tab(id);
      if (id === null || tab === null) return;
      if (desktopTabs) showTab(id);
      else window.open(tab.url, '_blank', 'noopener,noreferrer');
    },
    webTabs: desktopTabs,
    focusSection: (target) => pushHash(memory.hashOf(target)),
  }), [go, webTabs, desktopTabs, showTab, memory]);
  const openWebTab = useMemo(() => (desktopTabs ? (url: string, title: string) => tabActions.openWeb(url, title)
    : null), [desktopTabs, tabActions]);
  useExternalLinks(openWebTab);
  // 竖排标签存在本体里（11-08）：挂上就对上。书签和标签分开（第 8 批第 1 条），书签在网页栏单独一节。
  useWebTabsSync();
  const pageTitle = usePageTitle();
  const current = useMemo<CurrentTab>(() => (webTab !== null
    ? { id: webTab.id, kind: 'web', title: webTab.title === '' ? webTab.url : webTab.title, icon: 'globe',
      route: null, url: webTab.url, group: null }
    : { id: routeHash(route), kind: 'page', title: pageTitle(route), icon: pageIcon(route), route, url: null,
      group: null }), [webTab, route, pageTitle]);
  useMacCommands(() => {
    setPanel(null);
    expandChat();
  }, go, route.view);
  const chatOpen = layout.chat === 'dialog';
  const nativeTabs = useNativeWebTabs({ bridge: webBridge, tabs: webTabs, state: webState,
    activeId: webTab?.id ?? null, covered: activePanel !== null || settings.showing || palette
      || (layout.phone && chatOpen), showTab, openPage: go, steps: pageSteps });
  const webChrome = useWebChrome(expandChat, useCallback((noteId: string) => go({ view: 'notes', noteId }), [go]));
  useQuoteCommands(webChrome.quote);
  useIosAsk(() => {
    setPanel(null);
    expandChat();
  });
  // ⌘K 全局切换；⌘[ / ⌘] 后退前进（网页标签上交给网页自己）；鼠标侧键同样。
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (key === '\\') {
        const toggle = toggleColumnRef.current;
        if (toggle !== null) {
          event.preventDefault();
          toggle();
        }
      } else if (key === '[' || key === ']') {
        event.preventDefault();
        if (key === '[') goBack();
        else goForward();
      }
    };
    const mouse = (event: MouseEvent): void => {
      if (event.button === 3) goBack();
      if (event.button === 4) goForward();
    };
    window.addEventListener('keydown', keys);
    window.addEventListener('mouseup', mouse);
    return () => {
      window.removeEventListener('keydown', keys);
      window.removeEventListener('mouseup', mouse);
    };
  }, []);
  // 手机上 Plasticine 一页本身就是对话；读书、消息里点开的那一条整页不画圆球。
  const showBall = layout.chat === 'ball' && !workFullPage && !(layout.phone && (phoneFullPage(route) || browserPage));
  const closePanel = (): void => {
    if (panel !== null) setPanel(null);
    else if (workLink !== null) replaceHash(routeHash(lastPage.current));
  };
  const openPanel = (next: Panel | null): void => {
    if (next === null) {
      closePanel();
      return;
    }
    if (next.kind === 'settings') {
      settings.open(next.section, next.focus);
      return;
    }
    if (next.kind === 'search') {
      setPalette(true);
      return;
    }
    if (next.kind === 'tool' && next.name === '浏览器') {
      setPanel(null);
      go({ view: 'browser', noteId: null });
      return;
    }
    if (layout.phone) {
      shellPrefs.setPhoneChatOpen(false);
    }
    if (next.kind === 'work') {
      setPanel(null);
      const target = next.lineId !== undefined ? { lineId: next.lineId }
        : next.taskId !== undefined ? { taskId: next.taskId } : { groupTaskId: next.groupTaskId };
      pushHash(routeHash({ view: 'work', noteId: null, ...target }));
      return;
    }
    if (settings.link !== null) replaceHash(routeHash(lastPage.current));
    setPanel(next);
  };
  const openFromPalette = (target: PaletteTarget): void => {
    if (target.kind === 'route') {
      if (target.route.view === 'work') {
        pushHash(routeHash(target.route));
        return;
      }
      go(target.route);
    } else if (target.kind === 'tab') {
      openTabWeb(target.id);
    } else if (target.kind === 'reopen') {
      tabActions.reopenTab(target.key);
    } else if (target.kind === 'bookmark') {
      openBookmark(webTabs, tabActions.openWeb, { title: target.title, target: target.url });
    } else {
      currentComposer(targetState).ui.setDraft(target.text);
      expandChat();
    }
  };
  const newThing = (kind: NewKind): void => {
    if (kind === 'ask') expandChat();
    else if (kind === 'note') go({ view: 'notes', noteId: 'new' });
    else if (kind === 'tab') go({ view: 'web', noteId: null, webTabId: null });
    else setNewMate(true);
  };
  const phoneTab = (tab: PhoneTabId): void => {
    if (tab === 'more') setMore(true);
    else focusSection(tab);
  };
  const moreItem = (item: MoreItemId): void => {
    setMore(false);
    const target = MORE_ITEMS.find((entry) => entry.id === item);
    if (target !== undefined) go(target.route);
  };
  const column = !layout.phone && hasColumn(section);
  // 第二栏收起（11-08）：按栏目各记各的；网页收成窄栏，别的栏目整列让给主区，展开按钮在主区页头最左边。
  const columnCollapsed = column && prefs.collapsedColumns.includes(section);
  const columnHidden = columnCollapsed && section !== 'web';
  toggleColumnRef.current = column ? () => shellPrefs.setColumnCollapsed(section, !columnCollapsed) : null;
  const columnToggle: ColumnToggle = { collapsed: columnCollapsed, inTitlebar: titled,
    toggle: () => shellPrefs.setColumnCollapsed(section, !columnCollapsed) };

  return (
    <TabsContext.Provider value={tabActions}>
    <NativeWebTabsContext.Provider value={nativeTabs}>
    <WebTranslateProvider>
    <CurrentTabContext.Provider value={current}>
    <DockTargetSync />
    <PanelContext.Provider value={openPanel}>
    <TitlebarProvider state={titlebar}>
      {newMate ? <MateEditor phone={phone} navigate={go} onClose={() => setNewMate(false)} /> : null}
      <div className="shell" data-phone={layout.phone} data-section={section}
        data-native-web={webTab !== null && nativeTabs?.showing === true ? 'true' : undefined}
        data-titled={titled ? '' : undefined}
        data-column={columnHidden ? 'hidden' : columnCollapsed ? 'strip' : undefined}>
        {titled ? <Titlebar title={current.title} chrome={windowChrome} column={column ? columnToggle : null}
          state={titlebar} /> : null}
        {layout.phone ? null : (
          <Rail section={section} waiting={waiting} connection={connection} accountName={account.name}
            accountAvatar={account.avatar} onSection={focusSection} onSearch={() => setPalette(true)} onNew={newThing}
            onSettings={() => settings.open()} />
        )}
        <div className="shell-panel">
        <ColumnToggleContext.Provider value={columnToggle}>
        {column ? <ShellColumn section={section} route={route} navigate={go} webId={webTab?.id ?? null}
          onOpenTab={openTabWeb} onCloseTab={closeWebTab} onReopen={(entry) => tabActions.reopenTab(entry.key)}
          onAsk={expandChat} collapsed={columnCollapsed} onSearch={() => setPalette(true)} /> : null}
        <div className="shell-main-area">
          {columnHidden && !titled ? (
            <div className="column-reveal"><ColumnExpandButton tipSide="right" /></div>
          ) : null}
          <ConnectionBanner />
          <ClientUpdateBanner />
          <main
            ref={main.ref}
            className={`shell-main${browserPage ? ' shell-main-browser' : ''}${webTab !== null ? ' shell-main-web'
              : ''}`}
            onScroll={(event) => { main.onScroll(); phoneNavigation.onScroll(event.currentTarget.scrollTop); }}
          >
            <MainErrorBoundary key={webTab === null ? boundaryKey(route) : webTab.id} onHome={() => go(HOME)}>
              <PageEnter key={webTab === null ? routeHash(route) : webTab.id}>
                {webTab !== null ? <WebTabView tab={webTab} native={nativeTabs} phone={layout.phone}
                  web={webChrome} />
                  : browserPage ? <BrowserView onBack={() => go(beforeBrowser.current)} />
                    : <CurrentView {...{ route, phone: layout.phone, navigate: go, onBack: goBack }} />}
              </PageEnter>
            </MainErrorBoundary>
          </main>
          <Sheet
            open={activePanel !== null}
            variant={layout.phone ? 'drawer' : 'panel'}
            title={activePanel === null ? '' : panelTitle(activePanel)}
            className={activePanel?.kind === 'work' ? 'work-sheet' : undefined}
            onClose={closePanel}
            actions={workFullPage ? <IconButton icon="back" label="返回" className="work-back"
              onClick={closePanel} /> : undefined}
          >
            {activePanel === null ? null : <MainErrorBoundary key={panelTitle(activePanel)} onHome={() => {
              setPanel(null); go(HOME);
            }}><PanelBody panel={activePanel} navigate={go} /></MainErrorBoundary>}
          </Sheet>
        </div>
        </ColumnToggleContext.Provider>
        </div>
        {chatOpen && !workFullPage ? (
          <ChatDialog
            fullscreen={layout.phone}
            docked={layout.chatDocked}
            frame={prefs.chatFrame}
            onCollapse={collapseChat}
            onFrame={(frame) => shellPrefs.setChatFrame(frame)}
          />
        ) : null}
        {showBall ? <ChatBall waiting={ballWaiting(waiting, section === 'now')} onExpand={expandChat} /> : null}
        {layout.phone && !browserPage && !workFullPage ? (
          <PhoneBar route={route} hidden={phoneNavigation.hidden} waiting={waiting} onTab={phoneTab} />
        ) : null}
        {layout.phone ? <MoreDrawer open={more} waiting={waiting} onClose={() => setMore(false)} onItem={moreItem}
          onSettings={() => {
            setMore(false);
            settings.open();
          }} /> : null}
        {palette ? <Palette phone={layout.phone} onClose={() => setPalette(false)} onOpen={openFromPalette} />
          : null}
        {settings.element}
        <TooltipLayer />
        <ContextMenuLayer add={webChrome.quote} />
      </div>
    </TitlebarProvider>
    </PanelContext.Provider>
    </CurrentTabContext.Provider>
    </WebTranslateProvider>
    </NativeWebTabsContext.Provider>
    </TabsContext.Provider>
  );
}
