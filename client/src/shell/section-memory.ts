import { useCallback, useEffect, useMemo, useRef } from 'react';
import { routeHash, type Route } from './routes.ts';
import { SECTIONS, sectionOf, type SectionId } from './sections.ts';

const KEY = 'plasticine:sections:v2';

function read(): Partial<Record<SectionId, string>> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as Partial<Record<SectionId, string>> : {};
  } catch (cause) {
    console.warn('栏目上次停在哪没读到，点入口回到栏目开头', cause);
    return {};
  }
}

export interface SectionMemory {
  hashOf: (section: SectionId) => string;
}

export function useSectionMemory(route: Route, overlaid: boolean): SectionMemory {
  const remembered = useRef(read());
  const hash = routeHash(route);
  useEffect(() => {
    if (overlaid) return;
    remembered.current = { ...remembered.current, [sectionOf(route)]: hash };
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(remembered.current));
    } catch (cause) {
      console.warn('栏目上次停在哪没能记下', cause);
    }
  }, [hash, overlaid]);
  const hashOf = useCallback((section: SectionId) => remembered.current[section]
    ?? routeHash(SECTIONS[section].root), []);
  return useMemo(() => ({ hashOf }), [hashOf]);
}
