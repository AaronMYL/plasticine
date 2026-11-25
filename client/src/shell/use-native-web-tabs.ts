import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Value } from 'typebox/value';
import {
  WEB_PAGE_TOOLS,
  WebTabEventSchema,
  type PlasticineMacWebTabs,
  type WebPageTool,
  type WebPageToolName,
  type WebTabCommand,
  type WebTabFrame,
} from '../api/shared.ts';
import type { KeyValueStorage } from '../state/outbox.ts';
import { useStore } from '../state/use-store.ts';
import type { PageSteps } from '../state/page-steps.ts';
import { WebHistory } from '../state/tabs-history.ts';
import { siteOf, SiteZoom } from '../state/tabs-zoom.ts';
import type { WebTabsState, WebTabsStore } from '../state/web-tabs.ts';
import { collectHitRegions, useHitRegions } from './hit-regions.ts';
import { internalPage } from './internal-page.ts';
import { parseHash, type Route } from './routes.ts';
import { searchUrl } from './search-engine.ts';

export interface WebTabNav {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface NativeWebTabs {
  nav: Readonly<Record<string, WebTabNav>>;
  showing: boolean;
  setFrame: (frame: WebTabFrame | null) => void;
  command: (tabId: string, command: WebTabCommand) => void;
  navigate: (tabId: string, url: string) => void;
  tools: ReadonlySet<WebPageToolName>;
  tool: (tabId: string, tool: WebPageTool) => Promise<unknown>;
  zoomOf: (tabId: string) => number;
  setZoom: (tabId: string, factor: number) => void;
  history: WebHistory;
}

export function knownTools(bridge: PlasticineMacWebTabs | null): ReadonlySet<WebPageToolName> {
  const names: readonly string[] = bridge?.tools ?? [];
  return new Set(WEB_PAGE_TOOLS.filter((name) => names.includes(name)));
}

function localStorageOrNull(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch (cause) {
    console.warn('这台设备不让存本地数据：网页缩放和历史记录只在这次打开时有', cause);
    return null;
  }
}

export const NativeWebTabsContext = createContext<NativeWebTabs | null>(null);

function sameFrame(a: WebTabFrame | null, b: WebTabFrame | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width
    && a.height === b.height);
}

export interface NativeWebTabsInput {
  bridge: PlasticineMacWebTabs | null;
  tabs: WebTabsStore;
  state: WebTabsState;
  activeId: string | null;
  covered: boolean;
  showTab: (id: string | null) => void;
  openPage: (route: Route) => void;
  steps?: PageSteps;
}

export function useNativeWebTabs(input: NativeWebTabsInput): NativeWebTabs | null {
  const { bridge, tabs, state, activeId, covered, showTab, openPage, steps } = input;
  const [frame, setFrameState] = useState<WebTabFrame | null>(null);
  const [nav, setNav] = useState<Record<string, WebTabNav>>({});
  const [history] = useState(() => new WebHistory(localStorageOrNull()));
  const [siteZoom] = useState(() => new SiteZoom(localStorageOrNull()));
  const [zooms, setZooms] = useState<Record<string, number>>({});
  const zoomsRef = useRef(zooms);
  zoomsRef.current = zooms;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const setFrame = useCallback((next: WebTabFrame | null) => {
    setFrameState((previous) => (sameFrame(previous, next) ? previous : next));
  }, []);
  const loaded = useStore(tabs.loaded);
  const webTabs = tabs.live();
  const current = activeId === null ? null : state.tabs.find((tab) => tab.id === activeId) ?? null;
  useEffect(() => {
    if (bridge === null) return;
    for (const tab of state.tabs) {
      if (tab.openedBy === 'plasticine') continue;
      const internal = internalPage(tab.url);
      if (internal === null) continue;
      tabs.close(tab.id);
      bridge.command(tab.id, 'close');
      if (tab.id === activeId) openPage(internal);
    }
  }, [bridge, tabs, state.tabs, activeId, openPage]);
  const visible = current !== null && frame !== null && !covered;
  const hitRegions = useHitRegions(bridge !== null && visible ? frame : null);
  const digest = JSON.stringify({ loaded: loaded.size, tabs: webTabs.map((tab) => [tab.id, tab.url, tab.openedBy]),
    active: current?.id ?? null,
    frame: visible ? frame : null, hitRegions });
  useEffect(() => {
    if (bridge === null) {
      return;
    }
    const parsed = JSON.parse(digest) as { tabs: [string, string, 'user' | 'plasticine'][]; active: string | null;
      frame: WebTabFrame | null };
    const frame = parsed.frame;
    try {
      bridge.sync({ tabs: parsed.tabs.map(([tabId, url, openedBy]) => ({ tabId, url,
        ...(openedBy === 'plasticine' ? { openedBy } : {}) })),
        active: frame === null ? null : parsed.active, frame,
        hitRegions: frame === null ? [] : collectHitRegions(document, frame) });
    } catch (cause) {
      console.warn('网页标签没能同步给 Mac 原生层', cause);
    }
  }, [bridge, digest]);
  useEffect(() => {
    if (bridge === null) {
      return undefined;
    }
    const receive = (event: unknown): void => {
      if (!Value.Check(WebTabEventSchema, event)) {
        console.warn('Mac 原生层报来的网页标签事件格式不对，没有用', event);
        return;
      }
      switch (event.type) {
        case 'state': {
          const blank = event.url.trim() === '';
          setNav((previous) => ({ ...previous, [event.tabId]: {
            url: blank ? previous[event.tabId]?.url ?? tabs.tab(event.tabId)?.url ?? '' : event.url,
            title: blank ? previous[event.tabId]?.title ?? event.title : event.title,
            canGoBack: event.canGoBack, canGoForward: event.canGoForward, loading: event.loading } }));
          if (blank) {
            return;
          }
          tabs.update(event.tabId, { url: event.url, title: event.title });
          if (!event.loading) {
            history.record({ url: event.url, title: event.title, at: new Date().toISOString() });
          }
          applySiteZoom(event.tabId, event.url);
          return;
        }
        case 'opened': {
          if (event.url.trim() === '') {
            console.warn('桌面壳报来一个没有网址的新标签，没有收', event.tabId);
            return;
          }
          if (event.openedBy === 'user') {
            const internal = internalPage(event.url);
            if (internal !== null) {
              bridge.command(event.tabId, 'close');
              if (event.activate) openPage(internal);
              return;
            }
          }
          const adopted = tabs.adopt({ id: event.tabId, url: event.url, title: event.title,
            openedBy: event.openedBy, activate: event.activate });
          if (adopted !== null) showTab(adopted);
          return;
        }
        case 'closed': {
          const wasShown = activeRef.current === event.tabId;
          const next = tabs.close(event.tabId);
          if (wasShown) showTab(next);
          return;
        }
        case 'show':
          if (tabs.tab(event.tabId) !== null) showTab(event.tabId);
          return;
        case 'icon':
          tabs.setIcon(event.tabId, event.icon, event.pageUrl);
          return;
        case 'internal':
          openPage(parseHash(event.hash));
          return;
        case 'operate':
          steps?.apply(event);
          return;
      }
    };
    const applySiteZoom = (tabId: string, url: string): void => {
      if (siteOf(url) === null || !knownTools(bridge).has('zoom')) {
        return;
      }
      const factor = siteZoom.of(url);
      if ((zoomsRef.current[tabId] ?? 1) === factor) {
        return;
      }
      setZooms((previous) => ({ ...previous, [tabId]: factor }));
      bridge.tool?.(tabId, { kind: 'zoom', factor })
        .catch((cause: unknown) => console.warn('原生网页没能照记着的缩放', cause));
    };
    window.__plasticineWebTabEvent = receive;
    return () => {
      if (window.__plasticineWebTabEvent === receive) {
        delete window.__plasticineWebTabEvent;
      }
      try {
        bridge.sync({ tabs: tabs.live().map((tab) => ({ tabId: tab.id, url: tab.url,
          ...(tab.openedBy === 'plasticine' ? { openedBy: tab.openedBy } : {}) })), active: null, frame: null,
        hitRegions: [] });
      } catch (cause) {
        console.warn('网页标签没能在离开时藏起来', cause);
      }
    };
  }, [bridge, tabs, showTab, openPage, history, siteZoom, steps]);
  return useMemo(() => (bridge === null ? null : {
    nav,
    showing: visible,
    setFrame,
    command: (tabId, command) => bridge.command(tabId, command),
    navigate: (tabId, url) => {
      const internal = internalPage(url);
      if (internal === null) bridge.navigate(tabId, url);
      else openPage(internal);
    },
    tools: knownTools(bridge),
    tool: (tabId, tool) => {
      if (bridge.tool === undefined) {
        return Promise.reject(new Error('这个版本的 App 还不会这一样'));
      }
      return bridge.tool(tabId, tool);
    },
    zoomOf: (tabId) => zooms[tabId] ?? 1,
    setZoom: (tabId, factor) => {
      const reported = nav[tabId]?.url ?? '';
      siteZoom.set(reported === '' ? webUrl(tabs, tabId) : reported, factor);
      setZooms((previous) => ({ ...previous, [tabId]: factor }));
      bridge.tool?.(tabId, { kind: 'zoom', factor })
        .catch((cause: unknown) => console.warn('原生网页没能缩放', cause));
    },
    history,
  }), [bridge, nav, setFrame, visible, zooms, history, siteZoom, tabs, openPage]);
}

function webUrl(tabs: WebTabsStore, tabId: string): string {
  return tabs.tab(tabId)?.url ?? '';
}

export function typedUrl(input: string): string | null {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) {
    return text;
  }
  if (text !== '' && !/\s/.test(text) && /^[^/?#]+\.[a-z]{2,}(?:[:/?#]|$)/i.test(text)) {
    return `https://${text}`;
  }
  return null;
}

export function addressToUrl(input: string): string | null {
  const text = input.trim();
  if (text === '') {
    return null;
  }
  return typedUrl(text) ?? searchUrl(text);
}
