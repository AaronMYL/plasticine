import { useEffect } from 'react';
import { Store } from './store.ts';

export const PRESENCE_REPORT_MS = 60_000;

const current = new Store<string | null>(null);
let owner = 0;

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

export function lookingAt(conversation: string): boolean {
  return document.visibilityState === 'visible' && document.hasFocus() && current.get() === conversation;
}

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
