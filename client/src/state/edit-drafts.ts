// 记忆页和判断页里就地编辑的草稿：一条记忆的字和适用范围、一条判断要改成的 p、要记的现实结果。
// 草稿记着它基于的服务端版本（保存时就是 version，409 时据此对照）；另存一份进 sessionStorage：401 重新配对、切页、
// 刷新这个标签页之后都还在，存上了才清。离开页面前，还有草稿就问一句。

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

export function memoryDraftKey(entryId: string): string {
  return `memory:${entryId}`;
}

export function judgmentDraftKey(judgmentId: string, form: 'p' | 'outcome'): string {
  return `judgment:${judgmentId}:${form}`;
}

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

  /** 改一个字段；还没有草稿就以 baseVersion 起一份。 */
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

  /** 草稿换到新的版本上（「保留我的」、存上之后又写了字）。 */
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

  /** 成功回执只移除这次已保存的格；继续输入的字段按新版本保留。 */
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
      // 内存里的草稿还在；只是刷新页面会丢，离开前的提醒照样会问。
      console.warn('编辑草稿没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
