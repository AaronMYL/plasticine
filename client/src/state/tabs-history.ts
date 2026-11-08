// 网页的历史记录（2026-11-04 第 2 批 ⋯ 菜单「历史记录 ⌘Y」）：在网页侧记，不要原生新接口——原生网页标签每载完一页
// 报一次地址和标题（use-native-web-tabs.ts 的 state 事件），这里记成一条访问。连着两次是同一个网址只算一条（换的是
// 标题就更新标题）。存一份在 localStorage：只在这台设备上，最多 500 条，早的先丢。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export const HISTORY_STORAGE_KEY = 'plasticine:web-history';
/** 最多记这么多条：差不多一两周的浏览，再早的先丢。 */
export const HISTORY_MAX = 500;

const VisitSchema = Type.Object({
  url: Type.String({ minLength: 1 }),
  title: Type.String(),
  /** 什么时候打开的（ISO 时间）。 */
  at: Type.String({ minLength: 1 }),
});
export type WebVisit = Static<typeof VisitSchema>;
const StoredHistorySchema = Type.Object({ version: Type.Literal(1), visits: Type.Array(VisitSchema) });

function read(storage: KeyValueStorage | null): WebVisit[] {
  try {
    const raw = storage?.getItem(HISTORY_STORAGE_KEY) ?? null;
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return Value.Check(StoredHistorySchema, parsed) ? parsed.visits : [];
  } catch (cause) {
    console.warn('网页历史记录没能读出来，从空的开始记', cause);
    return [];
  }
}

/** 只记 http(s) 的网页：about:blank、出错页这些不算看过。 */
function worthRecording(url: string): boolean {
  return /^https?:\/\/[^/]/i.test(url);
}

export class WebHistory {
  /** 新的在前。 */
  readonly store: Store<readonly WebVisit[]>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null) {
    this.storage = storage;
    this.store = new Store<readonly WebVisit[]>(read(storage));
  }

  record(visit: WebVisit): void {
    if (!worthRecording(visit.url)) {
      return;
    }
    this.store.set((previous) => {
      const latest = previous[0];
      if (latest?.url === visit.url) {
        const title = visit.title === '' ? latest.title : visit.title;
        return title === latest.title ? previous : [{ ...latest, title }, ...previous.slice(1)];
      }
      return [visit, ...previous].slice(0, HISTORY_MAX);
    });
    try {
      this.storage?.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ version: 1, visits: this.store.get() }));
    } catch (cause) {
      console.warn('网页历史记录没能存下，这次的浏览不受影响', cause);
    }
  }

  /** 名字或网址里有这几个字的，新的在前；同一个网址只留最近一次。 */
  search(query: string, limit: number): WebVisit[] {
    const needle = query.trim().toLocaleLowerCase();
    const seen = new Set<string>();
    const found: WebVisit[] = [];
    for (const visit of this.store.get()) {
      if (seen.has(visit.url)) {
        continue;
      }
      seen.add(visit.url);
      if (needle === '' || visit.title.toLocaleLowerCase().includes(needle)
        || visit.url.toLocaleLowerCase().includes(needle)) {
        found.push(visit);
      }
      if (found.length >= limit) {
        break;
      }
    }
    return found;
  }
}
