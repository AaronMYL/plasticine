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

  discard(): void {
    for (const entry of this.entries.values()) {
      if (entry.dirty) {
        entry.discard();
      }
    }
  }
}

export const SettingsDraftsContext = createContext<SettingsDrafts | null>(null);

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

export type GoToSettings = (section: SettingsSection, focus?: SettingsFocus) => void;

export const SettingsGoContext = createContext<GoToSettings | null>(null);

