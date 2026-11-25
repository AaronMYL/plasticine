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

export function usePhone(): boolean {
  return useViewportWidth() < PHONE_BELOW;
}
