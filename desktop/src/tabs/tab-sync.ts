// 界面发来的标签清单（tabs:sync）：形状对就用；只是有几个标签的网址坏了（11-08 之前存下的空网址标签）时，丢掉那几个、
// 其余照用，不让一条坏数据把整份丢掉（那样所有网页标签都不显示）。别的地方不对还是整份不用。

import { Value } from 'typebox/value';
import { WebTabsSyncSchema, type WebTabsSync } from '../../../agent/shared/api/mac-bridge.ts';

export interface SyncReading {
  sync: WebTabsSync | null;
  /** 丢掉了几个坏标签。 */
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
