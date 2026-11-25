import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export const HISTORY_STORAGE_KEY = 'plasticine:web-history';
export const HISTORY_MAX = 500;

const VisitSchema = Type.Object({
  url: Type.String({ minLength: 1 }),
  title: Type.String(),
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

function worthRecording(url: string): boolean {
  return /^https?:\/\/[^/]/i.test(url);
}

export class WebHistory {
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
