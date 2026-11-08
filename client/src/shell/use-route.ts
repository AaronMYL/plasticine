// 当前路由跟着 location.hash 走；前进后退、刷新都对得上。

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pushHash } from './nav-history.ts';
import { navLabel, parseHash, routeHash, type Route } from './routes.ts';

const APP_TITLE = 'Plasticine';

/** 浏览器标签和历史里分得清是哪一页（用户视角审查 2026-11-01 第 16 条）：「笔记 · Plasticine」；现在就叫 Plasticine。 */
export function documentTitle(route: Route): string {
  return route.view === 'today' ? APP_TITLE : `${navLabel(route.view)} · ${APP_TITLE}`;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

function snapshot(): string {
  return window.location.hash;
}

export function useRoute(): { route: Route; navigate: (route: Route) => void; canGoBack: boolean; goBack: () => void } {
  const hash = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    document.title = documentTitle(parseHash(hash));
  }, [hash]);
  const navigate = useCallback((route: Route) => {
    pushHash(routeHash(route));
  }, []);
  const entry = window.history.state as { plasticinePrevious?: string; plasticineRoute?: string } | null;
  return { route: parseHash(hash), navigate,
    canGoBack: entry?.plasticineRoute === hash && entry.plasticinePrevious !== undefined,
    goBack: () => window.history.back() };
}
