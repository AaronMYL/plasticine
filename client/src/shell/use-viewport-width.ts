import { useSyncExternalStore } from 'react';
import { PHONE_BELOW } from './layout.ts';

function subscribe(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

function snapshot(): number {
  return window.innerWidth;
}

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 窄于 PHONE_BELOW 就是手机排法（和壳的 computeLayout 同一条线），给视图里按手机 / 桌面分开的行为用。 */
export function usePhone(): boolean {
  return useViewportWidth() < PHONE_BELOW;
}
