// 登录以后挂上直连（11-12《首次使用解耦》）：只在经 @账号的网址（<账号>.cyberhunter.top，走中继的那个）打开时才连；
// 本机、自己的网址打开不连（不经中继，省不了什么）。浏览器不支持 WebRTC 或 service worker 就照旧经中继。

import { useEffect, type ReactNode } from 'react';
import { useApi } from '../context.tsx';
import { SERVICE_WORKER_URL } from '../push-device.ts';
import { DIRECT_OPEN_EVENT, DirectChannel } from './direct-channel.ts';
import { installDirectBridge } from './sw-bridge.ts';

function supported(): boolean {
  return typeof window !== 'undefined' && 'RTCPeerConnection' in window && 'serviceWorker' in navigator
    && window.isSecureContext;
}

export function DirectLink(): ReactNode {
  const api = useApi();
  useEffect(() => {
    if (!supported()) return;
    let stopped = false;
    let cleanup = (): void => {};
    const controller = new AbortController();
    void (async () => {
      const account = await api.account.state(controller.signal);
      if (stopped || account.networkUrl === null || new URL(account.networkUrl).origin !== window.location.origin) {
        return;
      }
      await navigator.serviceWorker.register(SERVICE_WORKER_URL);
      if (stopped) return;
      const channel = new DirectChannel();
      const unbridge = installDirectBridge(channel, navigator.serviceWorker);
      const wake = (): void => {
        if (document.visibilityState === 'visible') channel.start();
      };
      document.addEventListener('visibilitychange', wake);
      const stopNotify = channel.onChange((open) => {
        if (open) window.dispatchEvent(new Event(DIRECT_OPEN_EVENT));
      });
      channel.start();
      cleanup = () => {
        stopNotify();
        document.removeEventListener('visibilitychange', wake);
        unbridge();
        channel.stop();
      };
    })().catch((error: unknown) => {
      console.info('直连没挂上，照旧经中继', error);
    });
    return () => {
      stopped = true;
      controller.abort();
      cleanup();
    };
  }, [api]);
  return null;
}
