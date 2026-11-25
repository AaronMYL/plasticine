import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';

export function useWaitingCount(): number {
  return useStore(useLive().asks.store).open.length;
}

export function ballWaiting(waiting: number, onHome: boolean): number {
  return onHome ? 0 : waiting;
}
