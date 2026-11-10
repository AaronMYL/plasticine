import { MAIN_LINE_ALIAS } from '../api/shared.ts';
import type { ActionOps } from './action-ops.ts';
import { AttachmentDrafts } from './attachment-drafts.ts';
import { ConversationUi } from './conversation-ui.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

export interface LineComposerState { ui: ConversationUi; attachments: AttachmentDrafts }
const INDEX = 'plasticine.line-composers';
function lineStorage(storage: KeyValueStorage | null, lineId: string): KeyValueStorage | null {
  if (storage === null) return null;
  const prefix = `${INDEX}:${encodeURIComponent(lineId)}:`;
  return { getItem: (key) => storage.getItem(prefix + key), setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key) };
}

/** 页内对话与悬浮框按线共用草稿；目标变化只换引用，不搬动内容。 */
export class ConversationRegistry {
  readonly revision = new Store(0);
  private readonly entries = new Map<string, LineComposerState>();
  private readonly ops: ActionOps;
  private readonly storage: KeyValueStorage | null;
  constructor(ui: ConversationUi, attachments: AttachmentDrafts, ops: ActionOps, storage: KeyValueStorage | null = null) {
    this.ops = ops;
    this.storage = storage;
    this.watch(MAIN_LINE_ALIAS, { ui, attachments });
    try {
      const raw = storage?.getItem(INDEX);
      const ids: unknown = raw == null ? null : JSON.parse(raw);
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') this.forLine(id);
    } catch { console.warn('各条对话的草稿索引未能读取，请检查浏览器存储。'); }
  }
  private watch(lineId: string, entry: LineComposerState): void {
    this.entries.set(lineId, entry);
    const changed = (): void => this.revision.set((value) => value + 1);
    entry.ui.store.subscribe(changed);
    entry.attachments.store.subscribe(changed);
  }
  forLine(lineId: string): LineComposerState {
    let entry = this.entries.get(lineId);
    if (entry === undefined) {
      const storage = lineStorage(this.storage, lineId);
      entry = { ui: new ConversationUi(storage), attachments: new AttachmentDrafts(storage, this.ops) };
      this.watch(lineId, entry);
      try { this.storage?.setItem(INDEX, JSON.stringify([...this.entries.keys()])); }
      catch { console.warn('对话草稿索引未能保存，请保持页面打开。'); }
    }
    return entry;
  }
  hasDrafts(): boolean {
    return [...this.entries.values()].some(({ ui }) => {
      const value = ui.store.get();
      return (value.draft.trim() !== '' || value.quotes.length > 0) && !ui.savedForRefresh();
    });
  }
  hasAttachments(): boolean { return [...this.entries.values()].some((entry) => entry.attachments.hasAny()); }
  saveForRefresh(): void { for (const entry of this.entries.values()) entry.ui.saveForRefresh(); }
}
