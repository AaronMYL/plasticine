import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { pushHash } from './nav-history.ts';
import { navLabel, parseHash, routeHash, type Route } from './routes.ts';

const APP_TITLE = 'Plasticine';

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
