import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

const EditDraftSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  baseVersion: Type.Integer({ minimum: 1 }),
  fields: Type.Record(Type.String(), Type.String()),
});
export type EditDraft = Static<typeof EditDraftSchema>;

const StoredDraftsSchema = Type.Object({ version: Type.Literal(1), drafts: Type.Array(EditDraftSchema) });

export const EDIT_DRAFTS_STORAGE_KEY = 'plasticine.edit-drafts';

function readStored(storage: KeyValueStorage | null): Map<string, EditDraft> {
  const drafts = new Map<string, EditDraft>();
  if (storage === null) {
    return drafts;
  }
  let parsed: unknown;
  try {
    const raw = storage.getItem(EDIT_DRAFTS_STORAGE_KEY);
    if (raw === null) {
      return drafts;
    }
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('读不到上次留下的编辑草稿（sessionStorage 不可用或不是 JSON），从空的开始', error);
    return drafts;
  }
  if (!Value.Check(StoredDraftsSchema, parsed)) {
    console.warn('上次留下的编辑草稿格式不对，不用它');
    return drafts;
  }
  for (const draft of parsed.drafts) {
    drafts.set(draft.key, draft);
  }
  return drafts;
}

export class EditDrafts {
  readonly store: Store<ReadonlyMap<string, EditDraft>>;
  private readonly storage: KeyValueStorage | null;

  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    this.store = new Store<ReadonlyMap<string, EditDraft>>(readStored(storage));
    this.store.subscribe(() => this.persist());
  }

  get(key: string): EditDraft | undefined {
    return this.store.get().get(key);
  }

  set(key: string, baseVersion: number, fields: Readonly<Record<string, string>>): void {
    this.store.set((drafts) => {
      const previous = drafts.get(key);
      const next = new Map(drafts);
      next.set(key, {
        key,
        baseVersion: previous?.baseVersion ?? baseVersion,
        fields: { ...previous?.fields, ...fields },
      });
      return next;
    });
  }

  rebase(key: string, baseVersion: number): void {
    const previous = this.get(key);
    if (previous === undefined) {
      return;
    }
    this.store.set((drafts) => {
      const next = new Map(drafts);
      next.set(key, { ...previous, baseVersion });
      return next;
    });
  }

  clear(key: string): void {
    this.store.set((drafts) => {
      if (!drafts.has(key)) {
        return drafts;
      }
      const next = new Map(drafts);
      next.delete(key);
      return next;
    });
  }

  replace(key: string, baseVersion: number, fields: Record<string, string>): void {
    this.store.set((drafts) => new Map(drafts).set(key, { key, baseVersion, fields }));
  }

  hasAny(): boolean {
    return this.store.get().size > 0;
  }

  private persist(): void {
    if (this.storage === null) {
      return;
    }
    const drafts = [...this.store.get().values()];
    try {
      if (drafts.length === 0) {
        this.storage.removeItem(EDIT_DRAFTS_STORAGE_KEY);
      } else {
        this.storage.setItem(EDIT_DRAFTS_STORAGE_KEY, JSON.stringify({ version: 1, drafts }));
      }
    } catch (error) {
      console.warn('编辑草稿没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
