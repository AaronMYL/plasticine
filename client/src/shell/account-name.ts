// 侧栏底部那一行的名字（2026-11-05 他定）：用「网络」里自己的显示名，没加入网络、没设就写「我」。
// 名字只在这台设备上显示，读的是账号与网络那一段同一份状态（live.network.status），不另起请求。

import { useEffect } from 'react';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';

export const DEFAULT_ACCOUNT_NAME = '我';

export function useAccountName(): string {
  const { network } = useLive();
  const status = useStore(network.status.data).value;
  useEffect(() => {
    network.status.open();
  }, [network]);
  const name = status?.account?.displayName.trim() ?? '';
  return name === '' ? DEFAULT_ACCOUNT_NAME : name;
}

/** 头像里的那个字：名字的第一个字（英文大写）。 */
export function accountInitial(name: string): string {
  const first = Array.from(name.trim())[0] ?? Array.from(DEFAULT_ACCOUNT_NAME)[0]!;
  return first.toLocaleUpperCase();
}
