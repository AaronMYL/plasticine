// 一个滚动区域记住自己的位置：key 换了（切视图、换笔记）先存旧的，再把新的恢复出来。
// 内容是异步读来的（笔记列表、正文）时，挂上那一刻还是「正在读…」，这时设非零的 scrollTop 会被浏览器夹成 0，
// 内容到了也不会再恢复。所以等调用方说「内容已就绪」（ready）再恢复；没恢复之前也不存，免得拿夹出来的 0
// 盖掉记下的位置。

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { useClientState } from './context.tsx';

export function useRememberedScroll<T extends HTMLElement>(
  key: string,
  ready = true,
): { ref: RefObject<T | null>; onScroll: () => void } {
  const { viewScroll } = useClientState();
  const ref = useRef<T>(null);
  /** 已经恢复过位置的那个 key；没恢复之前滚动事件不算数。 */
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
    // 主区的段落会异步到达：在浏览器确实能放下原阅读位置后再结束恢复。
    const observer = new MutationObserver(restore);
    if (restored.current !== key) observer.observe(element, { childList: true, subtree: true, characterData: true });
    const takeOver = () => { restored.current = key; observer.disconnect(); };
    element.addEventListener('wheel', takeOver, { passive: true });
    element.addEventListener('touchstart', takeOver, { passive: true });
    return () => {
      // 清理时 React 已替换旧页；此时 scrollTop 可能被新页高度夹到 0，不能盖掉旧页滚动记录。
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
