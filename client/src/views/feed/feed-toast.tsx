// 刷新完在页面顶上浮一条（第13批，11-14 Aaron：「完成后在页面顶部浮一次『新增了多少篇』，没有新内容或失败也要明确说」）：
// 「X 新增 12 篇」「暂无新内容」「X 没刷新成：在 Plasticine 浏览器里登录 X」，几秒后自己收。读屏念出来（role=status）。

import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import './feed-kinds.css';

/** 停多久再收。 */
export const FEED_TOAST_MS = 3_200;

export interface FeedToastState {
  text: string;
  /** 没刷新成的那种用另一种样子。 */
  failed: boolean;
  /** 同一句再来也重新计时。 */
  serial: number;
}

export const feedToast = new Store<FeedToastState | null>(null);

export function showFeedToast(text: string, failed = false): void {
  feedToast.set((current) => ({ text, failed, serial: (current?.serial ?? 0) + 1 }));
}

export function FeedToast(): ReactNode {
  const toast = useStore(feedToast);
  const [leaving, setLeaving] = useState(false);
  // 离开阅读页就收掉，回来不再浮上一回的那句。
  useEffect(() => () => feedToast.set(null), []);
  useEffect(() => {
    if (toast === null) return undefined;
    setLeaving(false);
    const leave = window.setTimeout(() => setLeaving(true), FEED_TOAST_MS);
    const gone = window.setTimeout(() => feedToast.set(null), FEED_TOAST_MS + 220);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, [toast]);
  return <div className="feed-toast-slot" aria-live="polite">
    {toast === null ? null : <div key={toast.serial} className="feed-toast" role="status"
      data-failed={toast.failed || undefined} data-leaving={leaving || undefined}>
      {toast.failed ? null : <Icon name="check" size={14} />}{toast.text}
    </div>}
  </div>;
}
