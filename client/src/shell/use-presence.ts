// 把网页的前台 / 后台接到 PresenceTracker（state/presence.ts）：可见且窗口有焦点算在前台；切走、最小化、锁屏、
// 窗口失焦、关页都算离开。在前台时每 30 秒记一次，关窗、崩溃时最多差这么多。

import { useEffect } from 'react';
import { PRESENCE_BEAT_MS, type PresenceTracker } from '../state/presence.ts';

export function usePresenceTracking(presence: PresenceTracker): void {
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        presence.visible();
      } else {
        presence.hidden();
      }
    };
    const onFocus = (): void => {
      if (document.visibilityState === 'visible') {
        presence.visible();
      }
    };
    const onBlur = (): void => presence.hidden();
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onBlur);
    const timer = window.setInterval(() => presence.beat(), PRESENCE_BEAT_MS);
    return () => {
      presence.hidden();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onBlur);
      window.clearInterval(timer);
    };
  }, [presence]);
}
