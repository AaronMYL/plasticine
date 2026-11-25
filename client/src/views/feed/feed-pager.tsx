import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export function useAutoMore(sentinel: RefObject<HTMLElement | null>, enabled: boolean, more: () => void): void {
  const latest = useRef(more);
  latest.current = more;
  useEffect(() => {
    const element = sentinel.current;
    if (!enabled || element === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) latest.current();
    }, { rootMargin: `0px 0px ${Math.max(window.innerHeight, 600)}px 0px` });
    observer.observe(element);
    return () => observer.disconnect();
  }, [sentinel, enabled]);
}

export function MoreState({ loading, end, error, onRetry }: { loading: boolean; end: boolean; error: string | null;
  onRetry: () => void }): ReactNode {
  if (error !== null) {
    return <p className="block-empty is-error" role="alert">{error}{' '}
      <button type="button" className="text-button" onClick={onRetry}>再读一次</button></p>;
  }
  if (loading) {
    return <div className="feed-more-state" role="status">
      <div className="feed-skeleton" aria-hidden="true"><span /><span /><span /></div>
      <span className="feed-more-line"><span className="feed-spin" aria-hidden="true" />正在读更早的</span>
    </div>;
  }
  return end ? <p className="feed-end">已到底</p> : null;
}
