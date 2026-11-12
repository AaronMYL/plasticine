// 右键一按（context-menu.tsx 发 CONTEXT_MENU_EVENT）：选中后弹出的小条收起，同一时间只出一个浮层（11-12 第 1 条）。

import { useEffect, useRef } from 'react';

export const CONTEXT_MENU_EVENT = 'plasticine:context-menu';

export function useCloseOnContextMenu(close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const onMenu = (): void => latest.current();
    window.addEventListener(CONTEXT_MENU_EVENT, onMenu);
    return () => window.removeEventListener(CONTEXT_MENU_EVENT, onMenu);
  }, []);
}
