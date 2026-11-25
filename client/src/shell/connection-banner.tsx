import { useEffect, useState, type ReactNode } from 'react';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';

export const CONNECTION_BANNER_AFTER_MS = 3000;

export function ConnectionBanner(): ReactNode {
  const live = useLive();
  const status = useStore(live.hub.status);
  const [shown, setShown] = useState(false);
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
    <div className="banner app-banner connection-banner" role="status" aria-live="polite">
      <span className="dot dot-closed" aria-hidden="true" />
      {status === 'connecting' ? '正在重新连接…' : '未连接 · 正在重连，这期间看到的可能不是最新的'}
    </div>
  );
}
