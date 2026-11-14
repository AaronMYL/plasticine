// 主线现在叫什么、用什么画风（第 12 批；画风 11-13）。头像和编辑弹框都读这里，各自不互相引用。

import { DEFAULT_MAIN, DEFAULT_MATE_VARIANT, type MainIdentity, type MateVariant } from '../../api/shared.ts';
import { useOptionalLive } from '../../live.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import type { MatesData } from './mates-store.ts';

const NO_MATES = new Store<MatesData>({ status: 'idle', error: null, mates: [], groups: [], legacyChats: [] });

/** 不在 LiveProvider 里（单独画的对话部件）时照旧是 Plasticine、扁平。 */
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
