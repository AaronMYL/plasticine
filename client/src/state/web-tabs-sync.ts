// 竖排标签和本体对上（11-08 他定：存在本体里，每台设备看到同一份）。
// · 连上时：读本体那一份，在它上面把这台设备还没送上去的几步重做一遍（rebase）；这台设备上有还没并上去的旧存档
//   （11-07 存在 localStorage 的、更早的顶部标签）或上次关掉前没送完的，用 merge 并上去（同一个网址已经有了的跳过），
//   并完删掉 11-07 那一份本地存档。
// · 本机每改一步，停 300ms 把整份送上去（带手上的版本）；别的设备先改过就 409，拿它带回来的那一份 rebase 再送。
// · 别的设备改了（webTabs.changed 的版本比手上的新）、断线补不上（resync）：手上没有要送的就重读一份。
// · 送不出去（断网）：连接恢复时再送；期间照样能用，改动先记在这台设备上。
// · 桌面壳报来的网站图标按网站存进本体（PUT /v2/favicon），别的设备画这个网站时也用它。

import type { EventsHub } from '../api/events-hub.ts';
import { ConflictError } from '../api/errors.ts';
import { createRequestId } from '../api/request-id.ts';
import { faviconHost, type WebTabsResponse } from '../api/shared.ts';
import type { WebTabsApi } from '../api/web-tabs-client.ts';
import { layoutOf, markLocalUploaded } from './web-tabs-storage.ts';
import type { WebTabsStore } from './web-tabs.ts';

/** 改完停这么久再送：拖动、连着关几个标签只送一次。 */
export const WEB_TABS_PUSH_DELAY_MS = 300;

/** 用到的那一点事件流：事件和连接状态。 */
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

  /** 第一次对上：读本体的，并上这台设备的旧存档和上次没送完的，再送这次的几步。 */
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
      // 上次关掉前没送完、这期间也没有别的设备改过：手上这一份就是最新的，整份送上去。
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
      // 手上有要送的：送的时候版本对不上会拿到最新的那一份，在那里 rebase。
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

  /** 壳报来的图标按网站存进本体（同一个网站同一张图这次打开只送一次）；送不出去不要紧，别的设备照旧本体代取。 */
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

  /** 把手上这一份送上去，直到没有要送的。 */
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
