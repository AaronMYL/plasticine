// 主区每个视图的滚动位置：切走再切回来，回到原来读到的地方。

import type { KeyValueStorage } from './outbox.ts';
const KEY = 'plasticine:view-scroll';
export class ViewScroll {
  private readonly positions = new Map<string, number>();
  private readonly storage: KeyValueStorage | null;
  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    try {
      const value: unknown = JSON.parse(storage?.getItem(KEY) ?? '{}');
      if (typeof value === 'object' && value !== null) {
        for (const [key, position] of Object.entries(value)) {
          if (typeof position === 'number' && Number.isFinite(position) && position >= 0) {
            this.positions.set(key, position);
          }
        }
      }
    } catch { console.warn('阅读位置未能恢复。'); }
  }

  save(viewKey: string, scrollTop: number): void {
    this.positions.set(viewKey, scrollTop);
    try { this.storage?.setItem(KEY, JSON.stringify(Object.fromEntries(this.positions))); }
    catch { console.warn('阅读位置未能保存。'); }
  }

  restore(viewKey: string): number {
    return this.positions.get(viewKey) ?? 0;
  }
}
