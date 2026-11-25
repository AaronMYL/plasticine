import { clipboard } from 'electron';
import { Value } from 'typebox/value';
import { TranslatePageMessageSchema, type TranslateDelivery, type TranslateEvent,
  type TranslatePageConfig } from '../../../agent/shared/api/mac-translate.ts';
import { isPaymentPage } from '../../../agent/shared/device-lanes.ts';
import type { Tab, TabViews } from './tab-views.ts';

export class TabTranslate {
  private readonly tabs: TabViews;
  private readonly emit: (event: TranslateEvent) => void;
  private readonly log: (line: string) => void;
  private readonly desired = new Map<string, TranslatePageConfig>();
  private readonly blocked = new Map<string, boolean>();

  constructor(tabs: TabViews, emit: (event: TranslateEvent) => void, log: (line: string) => void) {
    this.tabs = tabs;
    this.emit = emit;
    this.log = log;
  }

  configure(tabId: string, config: TranslatePageConfig | null): void {
    if (config === null) {
      this.desired.delete(tabId);
      this.call(tabId, 'translate.stop', {});
      return;
    }
    this.desired.set(tabId, config);
    if (this.blocked.get(tabId) !== true) {
      this.call(tabId, 'translate.start', { config });
    }
  }

  deliver(tabId: string, delivery: TranslateDelivery): void {
    if (this.desired.get(tabId)?.run !== delivery.run) {
      return;
    }
    this.call(tabId, 'translate.apply', { delivery });
  }

  message(tab: Tab, raw: unknown): void {
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'copy') {
      const text = (raw as { text?: unknown }).text;
      if (typeof text === 'string') {
        clipboard.writeText(text);
      }
      return;
    }
    if (!Value.Check(TranslatePageMessageSchema, raw)) {
      this.log('翻译脚本发来的消息形状不对，没转。');
      return;
    }
    if (raw.type === 'page') {
      const blocked = raw.blocked || isPaymentPage(raw.url);
      this.blocked.set(tab.id, blocked);
      this.emit({ type: 'page', url: raw.url, blocked, tabId: tab.id });
      const config = this.desired.get(tab.id);
      if (config !== undefined && !blocked) {
        this.call(tab.id, 'translate.start', { config });
      }
      return;
    }
    if (!this.desired.has(tab.id) && (raw.type === 'request' || raw.type === 'progress')) {
      return;
    }
    this.emit({ ...raw, tabId: tab.id });
  }

  forget(tabId: string): void {
    this.desired.delete(tabId);
    this.blocked.delete(tabId);
  }

  private call(tabId: string, op: string, args: Record<string, unknown>): void {
    void this.tabs.call(tabId, op, args).catch((error: unknown) => {
      this.log(`翻译：${op} 没送到（${error instanceof Error ? error.message : String(error)}）。`);
    });
  }
}
