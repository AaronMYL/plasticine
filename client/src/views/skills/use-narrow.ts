import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useNarrow<T extends HTMLElement>(below: number): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') { return undefined; }
    const measure = (): void => {
      const width = element.getBoundingClientRect().width;
      setNarrow(width > 0 && width < below);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [below]);
  return [ref, narrow];
}
