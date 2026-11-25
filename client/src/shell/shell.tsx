import { MateEditor } from '../views/mates/mate-editor.tsx';
import { currentComposer } from '../views/conversation/current-composer.ts';
import { DockTargetSync } from '../views/mates/dock-target.tsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode }
  from 'react';
import { useLive } from '../live.tsx';
import { useMacCommands } from '../mac/use-mac-commands.ts';
import { Sheet } from '../primitives/sheet/index.tsx';
import { useClientState } from '../state/context.tsx';
import { useRememberedScroll } from '../state/use-remembered-scroll.ts';
import { useStore } from '../state/use-store.ts';
import { webHash } from '../state/web-tabs.ts';
import { useTelemetry } from '../telemetry.ts';
import { Palette } from '../views/search/palette.tsx';
import type { PaletteTarget } from '../views/search/palette-results.ts';
import { openBookmark } from '../views/bookmarks/bookmark-address.ts';
import { BrowserView } from '../views/tools/browser-view.tsx';
import { AmbientLayer } from './ambient/ambient-layer.tsx';
import { ChatBall, ChatDialog } from './chat-dialog.tsx';
import { ShellColumn } from './columns/shell-column.tsx';
import { ColumnExpandButton, ColumnToggleContext, type ColumnToggle } from './columns/column-toggle.tsx';
import { CurrentTabContext, type CurrentTab } from './current-tab-context.ts';
import { CurrentView } from './current-view.tsx';
import { hostWebTabs, hostWindowChrome } from './host.ts';
import { IconButton } from './icon-button.tsx';
import { internalPage } from './internal-page.ts';
import { PHONE_BELOW, computeLayout } from './layout.ts';
import { goBack, goForward, pushHash, replaceHash } from './nav-history.ts';
import { useExternalLinks } from './open-external.ts';
import { pageIcon } from './page-look.ts';
import { usePageTitle } from './page-title.ts';
import { PanelContext, panelTitle, type Panel } from './panel.ts';
import { MoreDrawer, PhoneBar, phoneFullPage } from './phone-bar.tsx';
import { ToastHost } from '../primitives/toast/index.tsx';
import { ImageViewerHost } from '../primitives/image-viewer/index.tsx';
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
import { boundaryKey, linkedWork, PageEnter, PanelBody, shownWebId, type SheetPanel } from './shell-parts.tsx';
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
import { watchSegmented } from './segmented-slide.ts';
import { announceMigrationResult } from '../views/settings/migration-restart.tsx';

const TITLEBAR_ROOM = '--titlebar-room';

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
  useEffect(() => watchSegmented(document.body), []);
  useEffect(() => announceMigrationResult(), []);
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
  const [hasWindowChrome] = useState(() => hostWindowChrome() !== null);
  const titled = hasWindowChrome && !layout.phone;
  const titlebar = useTitlebarState(titled);
  useLayoutEffect(() => {
    if (!titled) return undefined;
    const root = document.documentElement;
    root.style.setProperty(TITLEBAR_ROOM, '44px');
    return () => { root.style.removeProperty(TITLEBAR_ROOM); };
  }, [titled]);

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
          <AmbientLayer route={route} main={main.ref} suspended={webTab !== null || browserPage} />
          {columnHidden && !titled ? (
            <div className="column-reveal"><ColumnExpandButton tipSide="right" /></div>
          ) : null}
          <ConnectionBanner />
          <ClientUpdateBanner />
          <main
            ref={main.ref}
            className={`shell-main${browserPage ? ' shell-main-browser' : ''}${webTab !== null ? ' shell-main-web'
              : ''}`}
            onScroll={(event) => {
              main.onScroll();
              phoneNavigation.onScroll(event.currentTarget.scrollTop);
            }}
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
              setPanel(null);
              go(HOME);
            }}><PanelBody panel={activePanel} navigate={go} /></MainErrorBoundary>}
          </Sheet>
          <ToastHost />
        </div>
        </ColumnToggleContext.Provider>
        </div>
        {chatOpen && !workFullPage ? (
          <ChatDialog
            fullscreen={layout.phone}
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
        <ImageViewerHost />
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
