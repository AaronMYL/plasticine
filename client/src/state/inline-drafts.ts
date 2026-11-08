// 任务条和要你定卡上就地写的一句（回答、退回去改要改什么、卡上写一句作答、问一句）。按那件东西的 id 存，key 和
// action-ops 的操作 key 一样（`task:<id>:answer`、`ask:<id>:ask` …）：切页、换对话容器、401 重新配对、刷新这个
// 标签页之后字都还在；两张卡之间切换不会把前一张的字带到后一张。发出去并拿到结果之后才清掉（审查 88c54ec P1）。
// 和待发记录一样另存一份进 sessionStorage；有草稿算进离开页面前的提醒。

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

  /** 写空就是清掉。 */
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

  /**
   * 那次请求发的就是这一句（发出时的那份）才清：待核实期间草稿被改过（比如重建组件后），成功回来不能把新写的
   * 字一起清掉（审查 3fe8226 P1）。sent 是 undefined（点的是选项、没带字）就不动草稿。
   */
  clearIfSent(key: string, sent: string | undefined): void {
    if (sent !== undefined && this.get(key).trim() === sent.trim()) {
      this.clear(key);
    }
  }

  /** 只有空白的不算草稿。 */
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
      // 内存里的草稿还在；只是刷新页面会丢，离开前的提醒照样会问。
      console.warn('就地草稿没存进 sessionStorage（可能满了或被禁用），刷新页面会丢', error);
    }
  }
}
