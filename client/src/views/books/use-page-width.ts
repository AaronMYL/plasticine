import { useEffect, useState } from 'react';

export function usePageWidth(page: HTMLElement | null): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    if (page === null) {
      return undefined;
    }
    const measure = (): void => setWidth(page.clientWidth || window.innerWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [page]);
  return width;
}
