import { MAIN_LINE_ALIAS } from '../api/shared.ts';
import type { KeyValueStorage } from './outbox.ts';
import { Store } from './store.ts';

const KEY = 'plasticine.chat-targets';
export interface DockTarget { lineId: string; pageKey: string; pageKind: string; fromWriter: boolean }

/** 记住每类页面手选的对象；作者是默认值，晚到的作者信息不能覆盖本页的手选。 */
export class DockTargets {
  readonly store = new Store<DockTarget>({ lineId: MAIN_LINE_ALIAS, pageKey: '', pageKind: '', fromWriter: false });
  readonly error = new Store<string | null>(null);
  setError(message: string): void { this.error.set(message); }
  protectCurrent(): void { this.manualPage = this.store.get().pageKey; }
  private readonly choices = new Map<string, string>();
  private readonly storage: KeyValueStorage | null;
  private manualPage: string | null = null;
  constructor(storage: KeyValueStorage | null) {
    this.storage = storage;
    try {
      const raw = storage?.getItem(KEY);
      const saved: unknown = raw == null ? null : JSON.parse(raw);
      if (saved !== null && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [kind, lineId] of Object.entries(saved)) {
          if (typeof lineId === 'string') this.choices.set(kind, lineId);
        }
      }
    } catch { console.warn('上次选择的对话对象未能读取，请检查浏览器存储。'); }
  }
  enterPage(pageKey: string, pageKind: string, writerLineId: string | null, available: ReadonlySet<string>): void {
    const current = this.store.get();
    if (pageKey !== current.pageKey) { this.manualPage = null; this.error.set(null); }
    const manual = this.manualPage === pageKey && available.has(current.lineId);
    const writer = writerLineId !== null && available.has(writerLineId) ? writerLineId : null;
    const remembered = this.choices.get(pageKind);
    const fallback = remembered !== undefined && available.has(remembered) ? remembered : MAIN_LINE_ALIAS;
    const lineId = manual ? current.lineId : writer ?? fallback;
    const fromWriter = manual ? current.fromWriter : writer !== null;
    if (current.lineId !== lineId || current.pageKey !== pageKey || current.pageKind !== pageKind
      || current.fromWriter !== fromWriter) this.store.set({ lineId, pageKey, pageKind, fromWriter });
  }
  choose(lineId: string): void {
    const current = this.store.get();
    this.manualPage = current.pageKey;
    this.choices.set(current.pageKind, lineId);
    this.store.set({ ...current, lineId, fromWriter: false });
    try { this.storage?.setItem(KEY, JSON.stringify(Object.fromEntries(this.choices))); }
    catch { console.warn('选择的对话对象未能保存，当前对话仍可继续。'); }
  }
}
