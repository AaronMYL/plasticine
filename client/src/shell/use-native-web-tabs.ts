// Mac 原生网页标签（2026-11-02 第 102 条第 3 批）：网页界面只画地址条，中间区那一块由原生 WKWebView 画。
// 这里把「开着哪些网页标签、哪一个在前、中间区在哪多大、有没有面板盖着、哪些浮层压在网页上（hitRegions）」整份同步给
// 原生层（每次有变化都发一整份），收原生层报来的地址、标题、能否前进后退，以及它自己开的新标签（网页里的新窗口、
// Plasticine 的 tab_open）。2026-11-03（Mac 0.3.0）起原生网页垫在主网页下面，对话框、圆球这些浮层直接盖在网页上，
// 每次都带 hitRegions（没有浮层是 []），原生据此认出新界面。协议在 agent/shared/api/mac-bridge.ts。
// 2026-11-04 第 2 批「浏览器」：原生报来会做的网页工具（web-page-tools.ts：查找、缩放、截图、打印、圈一块、缩略图、
// 下载），菜单只显示报了的；缩放按网站记住（换到记过的网站就照那一档缩放），每载完一页记一条历史记录，都在网页侧记。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  /** 各网页标签的原生现状；原生层还没报过的标签没有这一项。 */
  nav: Readonly<Record<string, WebTabNav>>;
  /** 原生网页这会儿正显示在主网页下面：主网页那一块不画底色。 */
  showing: boolean;
  /** 中间区（地址条下面那一块）的位置和大小；没有网页标签在前时是 null。 */
  setFrame: (frame: WebTabFrame | null) => void;
  command: (tabId: string, command: WebTabCommand) => void;
  navigate: (tabId: string, url: string) => void;
  /** 原生报了会做的网页工具；旧 App 一样都没有。 */
  tools: ReadonlySet<WebPageToolName>;
  /** 做一样网页工具；回的是未校验的数据（web-page-tools.ts 的 schema 校验后再用）。原生没有这个接口就抛错。 */
  tool: (tabId: string, tool: WebPageTool) => Promise<unknown>;
  /** 这个网页标签现在的缩放（按网站记着的那一档）。 */
  zoomOf: (tabId: string) => number;
  /** 换缩放：原生网页照着缩放，并按网站记住。 */
  setZoom: (tabId: string, factor: number) => void;
  /** 网页的历史记录（⋯ 菜单「历史记录」）。 */
  history: WebHistory;
}

/** 原生报来的网页工具里认得的那几样（不认得的名字不用）。 */
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

export function useNativeWebTabsContext(): NativeWebTabs | null {
  return useContext(NativeWebTabsContext);
}

function sameFrame(a: WebTabFrame | null, b: WebTabFrame | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width
    && a.height === b.height);
}

export interface NativeWebTabsInput {
  bridge: PlasticineMacWebTabs | null;
  tabs: WebTabsStore;
  state: WebTabsState;
  /** 主区现在开着的网页标签（地址 #/web/<id>）；主区是 Plasticine 自己的页面时是 null（原生网页藏起来）。 */
  activeId: string | null;
  /** 主区上面开着面板或抽屉（带遮罩、盖住整个主区）：原生网页先藏起来。对话框、圆球不算，它们报成 hitRegions。 */
  covered: boolean;
  /** 切到一个网页标签（壳走到 #/web/<id>）；关掉当前那个之后没有别的了是 null（回网页的开始页）。 */
  showTab: (id: string | null) => void;
  /** 原生网页里点到 Plasticine 自己的地址：壳走过去。 */
  openPage: (route: Route) => void;
  /** 第 3 批：Plasticine 在网页上做的一步记到这里（对话框里列出来）；不给就不记。 */
  steps?: PageSteps;
}

export function useNativeWebTabs(input: NativeWebTabsInput): NativeWebTabs | null {
  const { bridge, tabs, state, activeId, covered, showTab, openPage, steps } = input;
  const [frame, setFrameState] = useState<WebTabFrame | null>(null);
  const [nav, setNav] = useState<Record<string, WebTabNav>>({});
  const [history] = useState(() => new WebHistory(localStorageOrNull()));
  const [siteZoom] = useState(() => new SiteZoom(localStorageOrNull()));
  /** 每个网页标签现在照哪一档缩放（发给原生的最后一档）。 */
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
  // 指着 Plasticine 自己页面的网页标签（旧版里开出来的）：不再是标签，换成走到那一页。
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
  // 原生只开用到了的（今天的、这次点过的置顶 / 分组标签）；loaded 变了也要重发。
  const digest = JSON.stringify({ loaded: loaded.size, tabs: webTabs.map((tab) => [tab.id, tab.url, tab.openedBy]),
    active: current?.id ?? null,
    frame: visible ? frame : null, hitRegions });
  useEffect(() => {
    if (bridge === null) {
      return;
    }
    const parsed = JSON.parse(digest) as { tabs: [string, string, 'user' | 'plasticine'][]; active: string | null;
      frame: WebTabFrame | null };
    // 浮层这一刻现量（11-09）：useHitRegions 要晚一帧才量到，网页刚显示的那次同步会先报 []，桌面壳就先把网页叠到上面、
    // 盖住对话框几帧；它量到之后 digest 变了照样再同步一次。
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
          // 空网址（旧壳新开标签时报过）：只更新前进后退和载入中，网址、标题、浏览记录都不动。
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
    // 换到别的网站时照那个网站记着的一档缩放（原生网页的缩放跨页面留着，所以换回没记过的网站也要发一次 100%）。
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
      // 离开壳（退出登录）：只藏起来，标签和它们的登录状态留在原生层。
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

/** 一个网页标签记着的网址（原生还没报过地址时用）。 */
function webUrl(tabs: WebTabsStore, tabId: string): string {
  return tabs.tab(tabId)?.url ?? '';
}

/** 打的字像不像网址：带了 http(s) 原样用，像域名的补 https://；不像就是 null（新标签页拿它在 Plasticine 里查找）。 */
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

/** 地址栏里打的字变成要打开的网址：像网址的照 typedUrl，别的当搜索词。 */
export function addressToUrl(input: string): string | null {
  const text = input.trim();
  if (text === '') {
    return null;
  }
  return typedUrl(text) ?? searchUrl(text);
}
