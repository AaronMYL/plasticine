// 「正在看哪段对话」（第13批，11-14 Aaron：正在看的对话有新消息时不重复通知）：开着的那段对话（Plasticine 的线、
// 联系人或群的聊天）在这里登记；页面在前台时报给服务端（一分钟一次，切走、页面到后台报 null），服务端不推它；桌面
// 客户端收到通知事件时也先看这里，窗口在前台、正开着那段就不弹。

import { useEffect } from 'react';
import { Store } from './store.ts';

/** 隔多久再报一次（服务端 90 秒没收到就当没在看）。 */
export const PRESENCE_REPORT_MS = 60_000;

const current = new Store<string | null>(null);
let owner = 0;

/** 这一段对话开着时登记（line:<线 id> / contact:<联系人或群 id>）；关上时只清自己登记的那份。 */
export function useViewing(conversation: string | null): void {
  useEffect(() => {
    if (conversation === null) return undefined;
    owner += 1;
    const mine = owner;
    current.set(conversation);
    return () => {
      if (owner === mine) current.set(null);
    };
  }, [conversation]);
}

/** 现在开着的那段（页面不在前台时也照实给，调用方自己看 document）。 */
export function viewingNow(): string | null {
  return current.get();
}

/** 他眼下正看着这段：页面在前台、窗口有焦点、开着的就是它。 */
export function lookingAt(conversation: string): boolean {
  return document.visibilityState === 'visible' && document.hasFocus() && current.get() === conversation;
}

/**
 * 报给服务端：开着的对话变了、页面到前台 / 后台、窗口得到 / 失去焦点时马上报；在看着时每分钟再报一次。窗口没焦点
 * （人可能不在电脑前）就报 null，让别的设备照常收到。报不上不要紧，下一次再报。
 */
export function startPresenceReport(report: (conversation: string | null) => Promise<void>): () => void {
  let last: string | null | undefined;
  const send = (force: boolean): void => {
    const next = document.visibilityState === 'visible' && document.hasFocus() ? current.get() : null;
    if (!force && next === last) return;
    last = next;
    void report(next).catch(() => {
      last = undefined;
    });
  };
  const stopStore = current.subscribe(() => send(false));
  const onVisibility = (): void => send(false);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onVisibility);
  window.addEventListener('blur', onVisibility);
  const timer = window.setInterval(() => {
    if (last != null) send(true);
  }, PRESENCE_REPORT_MS);
  send(true);
  return () => {
    stopStore();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onVisibility);
    window.removeEventListener('blur', onVisibility);
    window.clearInterval(timer);
  };
}
