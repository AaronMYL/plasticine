import { useEffect, useRef, useState } from 'react';

// 手指停下后重新露出操作入口，不让导航一直藏着。
const SCROLL_IDLE_MS = 500;
export function usePhoneNavigation(): { hidden: boolean; onScroll: (top: number) => void } {
  const [hidden, setHidden] = useState(false);
  const previous = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { hidden, onScroll(top) {
    setHidden(top > previous.current && top > 48);
    previous.current = top;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHidden(false), SCROLL_IDLE_MS);
  } };
}
