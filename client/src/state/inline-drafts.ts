import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export const INLINE_DRAFTS_STORAGE_KEY = 'plasticine.inline-drafts';

const StoredDraftsSchema = Type.Object({
  version: Type.Literal(1),
  drafts: Type.Record(Type.String(), Type.String()),
});

function readStored(storage: KeyValueStorage | null): ReadonlyMap<string, string> {
  if (storage === null) {
    return new Map();
  }
  let parsed: unknown;
  try {
    const raw = storage.getItem(INLINE_DRAFTS_STORAGE_KEY);
    if (raw === null) {
      return new Map();
    }
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('读不到上次留下的就地草稿（sessionStorage 不可用或不是 JSON），从空的开始', error);
    return new Map();
  }
  if (!Value.Check(StoredDraftsSchema, parsed)) {
    console.warn('上次留下的就地草稿格式不对，不用它');
    return new Map();
  }
  return new Map(Object.entries(parsed.drafts));
}

export class InlineDrafts {
  readonly store: Store<ReadonlyMap<string, string>>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    this.store = new Store(readStored(storage));
    this.store.subscribe(() => this.persist());
  }

  get(key: string): string {
    return this.store.get().get(key) ?? '';
  }

  set(key: string, text: string): void {
    this.store.set((drafts) => {
      if ((drafts.get(key) ?? '') === text) {
        return drafts;
      }
      const next = new Map(drafts);
      if (text === '') {
        next.delete(key);
      } else {
        next.set(key, text);
      }
      return next;
    });
  }

  clear(key: string): void {
    this.set(key, '');
  }

  clearIfSent(key: string, sent: string | undefined): void {
    if (sent !== undefined && this.get(key).trim() === sent.trim()) {
      this.clear(key);
    }
  }

  hasAny(): boolean {
    return [...this.store.get().values()].some((text) => text.trim() !== '');
  }

  private persist(): void {
    if (this.storage === null) {
      return;
    }
    const drafts = this.store.get();
    try {
      if (drafts.size === 0) {
        this.storage.removeItem(INLINE_DRAFTS_STORAGE_KEY);
      } else {
        const payload = JSON.stringify({ version: 1, drafts: Object.fromEntries(drafts) });
        this.storage.setItem(INLINE_DRAFTS_STORAGE_KEY, payload);
      }
    } catch (error) {
      console.warn('就地草稿没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
