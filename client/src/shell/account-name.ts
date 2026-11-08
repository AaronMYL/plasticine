// 侧栏底部那一行的名字（2026-11-05 他定）：用「网络」里自己的显示名，没加入网络、没设就写「我」。
// 头像（11-08 第 7 批第 5 条）：设置里换过头像就画那张，没有才画名字的第一个字。
// 读的是账号与网络那一段同一份状态（live.network.status），不另起请求；设置里改名、换头像后重读它，图标栏跟着变。

import { useEffect } from 'react';
import { useLive } from '../live.tsx';
import { useStore } from '../state/use-store.ts';

export const DEFAULT_ACCOUNT_NAME = '我';

export interface AccountFace {
  name: string;
  /** 头像（data URL）；没换过是 null。 */
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

export function useAccountName(): string {
  return useAccountFace().name;
}

/** 头像里的那个字：名字的第一个字（英文大写）。 */
export function accountInitial(name: string): string {
  const first = Array.from(name.trim())[0] ?? Array.from(DEFAULT_ACCOUNT_NAME)[0]!;
  return first.toLocaleUpperCase();
}
