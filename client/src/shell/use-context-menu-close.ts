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
