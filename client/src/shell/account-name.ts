import { useEffect } from 'react';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';

export const DEFAULT_ACCOUNT_NAME = '我';

export interface AccountFace {
  name: string;
  avatar: string | null;
}

export function useAccountFace(): AccountFace {
  const { network } = useLive();
  const status = useStore(network.status.data).value;
  useEffect(() => {
    network.status.open();
  }, [network]);
  const name = status?.account?.displayName.trim() ?? '';
  return { name: name === '' ? DEFAULT_ACCOUNT_NAME : name, avatar: status?.account?.avatar ?? null };
}

export function accountInitial(name: string): string {
  const first = Array.from(name.trim())[0] ?? Array.from(DEFAULT_ACCOUNT_NAME)[0]!;
  return first.toLocaleUpperCase();
}
