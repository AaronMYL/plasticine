// 每个栏目上次停在哪（点图标栏的入口回到那里，像 Muse、Arc 那样各栏目各记一份）：只记地址，存在 sessionStorage，
// 刷新还在，关掉窗口重来。设置和工作详情是盖在页上的，不记。

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { routeHash, type Route } from './routes.ts';
import { SECTIONS, sectionOf, type SectionId } from './sections.ts';

const KEY = 'plasticine:sections';

function read(): Partial<Record<SectionId, string>> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as Partial<Record<SectionId, string>> : {};
  } catch (cause) {
    console.warn('栏目上次停在哪读不出来，点入口回到栏目开头', cause);
    return {};
  }
}

export interface SectionMemory {
  /** 点这个栏目的入口去哪：上次停在的地方，没有就是栏目开头。 */
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
