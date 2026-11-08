// 连接状态横幅（用户视角审查 2026-11-01 第 4 条）：事件流断开超过几秒，在主区顶部出一条和「试跑中」同样式的
// 细横幅，手机和桌面都显示；恢复后自动消失。侧栏脚的点照旧，这里是给手机和侧栏收起时看的。

import { useEffect, useState, type ReactNode } from 'react';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';

/** 断开多久才提示：短暂重连不打扰。 */
export const CONNECTION_BANNER_AFTER_MS = 3000;

export function ConnectionBanner(): ReactNode {
  const live = useLive();
  const status = useStore(live.hub.status);
  const [shown, setShown] = useState(false);
  // 只看「连着 / 没连着」：重连时 connecting ↔ closed 来回跳，不能每跳一次就重新计时，不然退避间隔短于阈值时永远不出。
  const open = status === 'open';
  useEffect(() => {
    if (open) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), CONNECTION_BANNER_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (!shown) {
    return null;
  }
  return (
    <div className="client-update-banner connection-banner text-meta" role="status" aria-live="polite">
      <span className="dot dot-closed" aria-hidden="true" />
      {status === 'connecting' ? '正在重新连接…' : '未连接 · 正在重连，这期间看到的可能不是最新的'}
    </div>
  );
}
