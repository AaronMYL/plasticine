// 设备与度量页的界面状态（M5）：在看哪个 tab、哪几台节点的上限表单开着、刚领到的配对码。放在 state/：切页回来照旧。
// 配对码只在内存里，不进 sessionStorage：它是 10 分钟内一次有效的凭据，刷新之后要用就再领一个。

import type { NodePairingCodeResponse } from '../api/types.ts';
import { Store } from './store.ts';

export const DEVICE_TABS = ['devices', 'metrics', 'system', 'activation'] as const;
export type DeviceTab = (typeof DEVICE_TABS)[number];

export const DEVICE_TAB_LABELS: Readonly<Record<DeviceTab, string>> = {
  devices: '设备',
  metrics: '度量',
  system: '运行与更新',
  activation: '启用',
};

export interface DeviceUiState {
  tab: DeviceTab;
  editing: ReadonlySet<string>;
  code: NodePairingCodeResponse | null;
}

export class DeviceUi {
  readonly store = new Store<DeviceUiState>({ tab: 'devices', editing: new Set(), code: null });

  setTab(tab: DeviceTab): void {
    this.store.set((state) => (state.tab === tab ? state : { ...state, tab }));
  }

  setEditing(nodeId: string, editing: boolean): void {
    this.store.set((state) => {
      if (state.editing.has(nodeId) === editing) {
        return state;
      }
      const next = new Set(state.editing);
      if (editing) {
        next.add(nodeId);
      } else {
        next.delete(nodeId);
      }
      return { ...state, editing: next };
    });
  }

  showCode(code: NodePairingCodeResponse | null): void {
    this.store.set((state) => ({ ...state, code }));
  }
}
