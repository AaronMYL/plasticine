import { DEFAULT_MAIN, DEFAULT_MATE_VARIANT, type MainIdentity, type MateVariant } from '../../api/shared.ts';
import { useOptionalLive } from '../../live.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import type { MatesData } from './mates-store.ts';

const NO_MATES = new Store<MatesData>({ status: 'idle', error: null, mates: [], groups: [], legacyChats: [] });

export function useMainIdentity(): MainIdentity {
  const live = useOptionalLive();
  return useStore(live?.mates.data ?? NO_MATES).main ?? DEFAULT_MAIN;
}

export function useMainName(): string {
  return useMainIdentity().name;
}

export function useMainVariant(): MateVariant {
  return useMainIdentity().variant ?? DEFAULT_MATE_VARIANT;
}
