import { Value } from 'typebox/value';
import { WebTabsSyncSchema, type WebTabsSync } from '../../../agent/shared/api/mac-bridge.ts';

export interface SyncReading {
  sync: WebTabsSync | null;
  dropped: number;
}

export function readSync(raw: unknown): SyncReading {
  if (Value.Check(WebTabsSyncSchema, raw)) {
    return { sync: raw, dropped: 0 };
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { tabs?: unknown }).tabs)) {
    return { sync: null, dropped: 0 };
  }
  const tabs = (raw as { tabs: unknown[] }).tabs;
  const item = WebTabsSyncSchema.properties.tabs.items;
  const kept = tabs.filter((tab) => Value.Check(item, tab));
  const candidate = { ...raw, tabs: kept };
  if (kept.length === tabs.length || !Value.Check(WebTabsSyncSchema, candidate)) {
    return { sync: null, dropped: 0 };
  }
  return { sync: candidate, dropped: tabs.length - kept.length };
}
