// 设置弹框给段里各块的两样东西：「有没保存的修改」的登记处，和「跳到别的段」（账号里「管理已配对的设备」到「系统」）。
// 有没保存的修改（2026-11-05 他定：有改动时关弹框、切段先在弹框里问一句）：
// 各段原来的草稿各存各的（就地草稿 inlineDrafts、翻译设置的组件状态、API key 的输入框），这里不再另起一份：
// 有草稿的那一块挂上 useSettingsDraft，报告自己现在有没有改动、放弃时怎么清掉。弹框只问挂着的这些——
// 挂着的就是当前这一段里正显示的。弹框外（测试单独渲染一块）没有登记处，挂了也不做事。

import { createContext, useContext, useEffect, useId, useRef } from 'react';
import type { SettingsFocus } from '../../shell/panel.ts';
import type { SettingsSection } from '../../shell/routes.ts';

interface Entry {
  dirty: boolean;
  discard: () => void;
}

export class SettingsDrafts {
  private readonly entries = new Map<string, Entry>();

  set(id: string, entry: Entry): void {
    this.entries.set(id, entry);
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  dirty(): boolean {
    return [...this.entries.values()].some((entry) => entry.dirty);
  }

  /** 「放弃修改」：有改动的那几块各自清掉草稿，回到已保存的样子。 */
  discard(): void {
    for (const entry of this.entries.values()) {
      if (entry.dirty) {
        entry.discard();
      }
    }
  }
}

export const SettingsDraftsContext = createContext<SettingsDrafts | null>(null);

/**
 * 这一块有没保存的改动：dirty 为真时关弹框、切段会先问；放弃时调 discard。返回在不在设置弹框里（在里面就由弹框问，
 * 块里不用再常显「有未保存的…」那一句）。
 */
export function useSettingsDraft(dirty: boolean, discard: () => void): boolean {
  const registry = useContext(SettingsDraftsContext);
  const id = useId();
  const latest = useRef(discard);
  latest.current = discard;
  useEffect(() => {
    if (registry === null) {
      return undefined;
    }
    registry.set(id, { dirty, discard: () => latest.current() });
    return () => registry.delete(id);
  }, [registry, id, dirty]);
  return registry !== null;
}

/** 在弹框里跳到另一段（有没保存的修改时同样先问）；弹框外是 null。 */
export type GoToSettings = (section: SettingsSection, focus?: SettingsFocus) => void;

export const SettingsGoContext = createContext<GoToSettings | null>(null);

export function useGoToSettings(): GoToSettings | null {
  return useContext(SettingsGoContext);
}
