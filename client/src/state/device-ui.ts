import type { NodePairingCodeResponse } from '../api/types.ts';
import { Store } from './store.ts';

export const DEVICE_TABS = ['devices', 'metrics', 'system', 'activation'] as const;
export type DeviceTab = (typeof DEVICE_TABS)[number];

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
