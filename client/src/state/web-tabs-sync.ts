import type { EventsHub } from './events-hub.ts';
import { ConflictError } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import { faviconHost, type WebTabsResponse } from '../api/shared.ts';
import type { WebTabsApi } from '../api/web-tabs-client.ts';
import { layoutOf, markLocalUploaded } from './web-tabs-storage.ts';
import type { WebTabsStore } from './web-tabs.ts';

export const WEB_TABS_PUSH_DELAY_MS = 300;

export type SyncHub = Pick<EventsHub, 'on' | 'status'>;

export class WebTabsSync {
  private readonly tabs: WebTabsStore;
  private readonly api: WebTabsApi;
  private readonly hub: SyncHub;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private loaded = false;
  private started = false;
  private stopped = false;
  private cleanups: (() => void)[] = [];
  private readonly sentIcons = new Set<string>();

  constructor(options: { tabs: WebTabsStore; api: WebTabsApi; hub: SyncHub; now?: () => Date }) {
    this.tabs = options.tabs;
    this.api = options.api;
    this.hub = options.hub;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.cleanups = [
      this.tabs.onLocalChange(() => this.schedule()),
      this.tabs.onIcon((report) => void this.rememberIcon(report.pageUrl, report.icon)),
      this.hub.on((event) => {
        if (event.type === 'resync' || (event.type === 'webTabs.changed' && event.version > this.tabs.version())) {
          void this.reload();
        }
      }),
      this.hub.status.subscribe(() => {
        if (this.hub.status.get() === 'open') {
          void (this.loaded ? this.flush() : this.load());
        }
      }),
    ];
    void this.load();
  }

  stop(): void {
    this.stopped = true;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async load(): Promise<void> {
    let remote: WebTabsResponse;
    try {
      remote = await this.api.get();
    } catch (cause) {
      console.warn('竖排标签这次没读到本体那一份，先用这台设备上的，连上再对', cause);
      return;
    }
    if (this.stopped) {
      return;
    }
    const first = !this.loaded;
    const legacy = first ? this.tabs.localLegacy : null;
    if (first && this.tabs.unsentAtStart && legacy === null && remote.version === this.tabs.version()) {
      this.loaded = true;
      this.tabs.keepLocal();
      await this.flush();
      return;
    }
    const carry = legacy !== null ? layoutOf(legacy) : first && this.tabs.unsentAtStart ? this.tabs.layout() : null;
    if (carry !== null) {
      try {
        remote = await this.api.merge({ requestId: createRequestId(), layout: carry });
      } catch (cause) {
        console.warn('这台设备上的竖排标签这次没并上去，下次连上再并（原样留着）', cause);
        return;
      }
      if (legacy !== null) {
        markLocalUploaded(this.tabs.storage, this.now().toISOString());
      }
    }
    this.loaded = true;
    this.tabs.rebase(remote.layout, remote.version);
    await this.flush();
  }

  private async reload(): Promise<void> {
    if (!this.loaded) {
      await this.load();
      return;
    }
    if (this.sending || this.tabs.unsent() > 0) {
      return;
    }
    try {
      const remote = await this.api.get();
      if (!this.stopped && !this.sending && this.tabs.unsent() === 0) {
        this.tabs.rebase(remote.layout, remote.version);
      }
    } catch (cause) {
      console.warn('竖排标签在别处改了，这次没读到新的，连上再对', cause);
    }
  }

  private async rememberIcon(pageUrl: string, icon: string): Promise<void> {
    const key = `${faviconHost(pageUrl) ?? ''}|${icon.length}|${icon.slice(-64)}`;
    if (this.sentIcons.has(key)) {
      return;
    }
    this.sentIcons.add(key);
    try {
      await this.api.rememberIcon({ requestId: createRequestId(), pageUrl, icon });
    } catch (cause) {
      this.sentIcons.delete(key);
      console.warn('网站图标没存进本体，别的设备照旧本体去取', cause);
    }
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, WEB_TABS_PUSH_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (!this.loaded || this.sending || this.stopped) {
      return;
    }
    this.sending = true;
    try {
      while (this.tabs.unsent() > 0 && !this.stopped) {
        const count = this.tabs.unsent();
        try {
          const saved = await this.api.put({ requestId: createRequestId(), baseVersion: this.tabs.version(),
            layout: this.tabs.layout() });
          this.tabs.acknowledge(count, saved.version);
        } catch (cause) {
          if (!(cause instanceof ConflictError)) {
            console.warn('竖排标签这次没送上去，连上再送（改动先留在这台设备上）', cause);
            return;
          }
          const current = cause.current as WebTabsResponse;
          this.tabs.rebase(current.layout, current.version);
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
