import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { useClientState } from './context.tsx';

export function useRememberedScroll<T extends HTMLElement>(
  key: string,
  ready = true,
): { ref: RefObject<T | null>; onScroll: () => void } {
  const { viewScroll } = useClientState();
  const ref = useRef<T>(null);
  const restored = useRef<string | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || !ready) {
      return undefined;
    }
    const wanted = viewScroll.restore(key);
    const restore = () => {
      if (restored.current === key) return;
      element.scrollTop = wanted;
      if (Math.abs(element.scrollTop - wanted) < 1) restored.current = key;
    };
    restore();
    const observer = new MutationObserver(restore);
    if (restored.current !== key) observer.observe(element, { childList: true, subtree: true, characterData: true });
    const takeOver = () => {
      restored.current = key;
      observer.disconnect();
    };
    element.addEventListener('wheel', takeOver, { passive: true });
    element.addEventListener('touchstart', takeOver, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', takeOver);
      element.removeEventListener('touchstart', takeOver);
      restored.current = null;
    };
  }, [key, ready, viewScroll]);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (element !== null && restored.current === key) {
      viewScroll.save(key, element.scrollTop);
    }
  }, [key, viewScroll]);

  return { ref, onScroll };
}
