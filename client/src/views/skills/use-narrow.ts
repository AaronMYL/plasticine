// 主区够不够并排放两栏：量这一页自己的宽（对话框停靠、窗口拉窄都会让主区变窄，看窗口宽度不准）。

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useNarrow<T extends HTMLElement>(below: number): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') { return undefined; }
    const measure = (): void => {
      const width = element.getBoundingClientRect().width;
      // 还没排版（宽 0）时不算窄。
      setNarrow(width > 0 && width < below);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [below]);
  return [ref, narrow];
}
