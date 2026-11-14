// 信息流接着读（11-12 第 3 条）：离底部一屏自动接着读更早的；读的时候一张骨架卡和一行「正在读更早的」，同一时间只发一个
// 请求（FeedStore.more 管去重）；没有更早的了写「已到底」。到顶接着往上拉的刷新第13批去掉了（Aaron），刷新在第二栏
// 「信息流」那一行和每一种来源的名字旁边（feed-source-list.tsx、feed-kind-head.tsx）。

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/** 底下那一条进到离视口一屏以内就接着读。 */
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
