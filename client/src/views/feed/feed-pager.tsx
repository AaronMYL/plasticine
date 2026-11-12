// 信息流接着读与刷新（11-12 第 3 条）：
// - 离底部一屏自动接着读更早的；读的时候一张骨架卡和一行「正在读更早的」，同一时间只发一个请求（FeedStore.more 管去重）；
//   没有更早的了写「已到底」。
// - 到顶后接着往上（电脑滚轮、手机下拉）拉过一段就刷新：先马上重读已经收好的；离上次去来源抓超过 30 分钟，再在后台抓一次，
//   抓完有新的出「n 条新内容」（往下读着时浮在顶上，点了回到顶部）；什么都没有写「暂无新内容」。

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FeedItemView } from '../../api/types.ts';
import { Icon } from '../../shell/icons.tsx';

/** 拉过这么多才刷新。 */
export const PULL_TRIGGER_PX = 72;
/** 离上次去来源抓超过这么久，刷新时顺带在后台抓一次（Aaron 11-12 同意 30 分钟）。 */
export const COLLECT_AFTER_MS = 30 * 60_000;
/** 「暂无新内容」停多久。 */
const NOTE_SHOWN_MS = 2400;

/** 往上找第一个能竖着滚的祖先；找不到就是整页。 */
export function scrollerOf(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

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

export type PullPhase = { kind: 'idle' } | { kind: 'pulling'; distance: number } | { kind: 'refreshing' }
  | { kind: 'note'; text: string };

/** 到顶后接着往上拉：返回现在拉到哪一步。onRefresh 结束时返回要显示的一句（null 就不显示）。 */
export function usePullRefresh(board: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<string | null>): PullPhase {
  const [phase, setPhase] = useState<PullPhase>({ kind: 'idle' });
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  const busy = useRef(false);
  useEffect(() => {
    const scroller = scrollerOf(board.current);
    if (scroller === null) return undefined;
    let distance = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let touchY: number | null = null;
    const fire = (): void => {
      if (busy.current) return;
      busy.current = true;
      distance = 0;
      setPhase({ kind: 'refreshing' });
      latest.current().then((text) => {
        setPhase(text === null ? { kind: 'idle' } : { kind: 'note', text });
        if (text !== null) setTimeout(() => setPhase({ kind: 'idle' }), NOTE_SHOWN_MS);
      }, (cause: unknown) => {
        console.warn('信息流刷新没成', cause);
        setPhase({ kind: 'idle' });
      }).finally(() => { busy.current = false; });
    };
    const pull = (delta: number): void => {
      distance = Math.max(0, distance + delta);
      if (distance >= PULL_TRIGGER_PX) fire();
      else setPhase(distance === 0 ? { kind: 'idle' } : { kind: 'pulling', distance });
    };
    const wheel = (event: WheelEvent): void => {
      if (busy.current || scroller.scrollTop > 0 || event.deltaY >= 0) return;
      pull(-event.deltaY / 2);
      clearTimeout(settle);
      settle = setTimeout(() => { if (!busy.current) { distance = 0; setPhase({ kind: 'idle' }); } }, 260);
    };
    const touchStart = (event: TouchEvent): void => {
      touchY = scroller.scrollTop <= 0 ? event.touches[0]?.clientY ?? null : null;
    };
    const touchMove = (event: TouchEvent): void => {
      const y = event.touches[0]?.clientY;
      if (touchY === null || y === undefined || busy.current) return;
      distance = 0;
      pull((y - touchY) / 2);
    };
    const touchEnd = (): void => {
      touchY = null;
      if (!busy.current) { distance = 0; setPhase({ kind: 'idle' }); }
    };
    scroller.addEventListener('wheel', wheel, { passive: true });
    scroller.addEventListener('touchstart', touchStart, { passive: true });
    scroller.addEventListener('touchmove', touchMove, { passive: true });
    scroller.addEventListener('touchend', touchEnd);
    return () => {
      clearTimeout(settle);
      scroller.removeEventListener('wheel', wheel);
      scroller.removeEventListener('touchstart', touchStart);
      scroller.removeEventListener('touchmove', touchMove);
      scroller.removeEventListener('touchend', touchEnd);
    };
  }, [board]);
  return phase;
}

/** 刷新前后条目比一比：前面多出来几条。 */
export function newCount(before: ReadonlySet<string>, after: readonly FeedItemView[]): number {
  return after.filter((item) => !before.has(item.id)).length;
}

export function PullIndicator({ phase }: { phase: PullPhase }): ReactNode {
  if (phase.kind === 'idle') return null;
  if (phase.kind === 'pulling') {
    const ready = Math.min(1, phase.distance / PULL_TRIGGER_PX);
    return <div className="feed-pull" style={{ height: `${Math.round(ready * 48)}px`, opacity: ready }}
      aria-hidden="true"><Icon name="arrow-down" size={14} /></div>;
  }
  return <div className="feed-pull" role="status">
    {phase.kind === 'refreshing' ? <><span className="feed-spin" aria-hidden="true" />正在刷新</> : phase.text}
  </div>;
}

export function NewItemsPill({ count, onJump }: { count: number; onJump: () => void }): ReactNode {
  return count <= 0 ? null : <button type="button" className="feed-new-pill" onClick={onJump}>
    <Icon name="chevron-up" size={13} />{count} 条新内容</button>;
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
