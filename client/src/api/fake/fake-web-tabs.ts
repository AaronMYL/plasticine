// 假的竖排标签存档（11-08，和真服务端 agent/src/app/web-tabs.ts 同一套规矩）：整份换按版本，过时回 409 带现在那一份；
// 合并同一个网址跳过（shared 的 mergeLayouts）；写成了发 webTabs.changed。图标：演示网站给示意图标，别的没有。

import { mergeLayouts, normalizeLayout, sameLayout } from '../../../../agent/shared/web-tabs-layout.ts';
import { ApiError, ConflictError } from '../errors.ts';
import { faviconHost } from '../shared.ts';
import type {
  MergeWebTabsRequest,
  PutFaviconRequest,
  PutFaviconResponse,
  PutWebTabsRequest,
  PutWebTabsResponse,
  WebTabsLayout,
  WebTabsResponse,
} from '../shared.ts';
import type { WebTabsApi } from '../web-tabs-client.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';
import { demoFavicon } from './tabs-seed.ts';

export interface FakeWebTabsDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  bus: FakeEventBus;
}

export class FakeWebTabs implements WebTabsApi {
  private readonly deps: FakeWebTabsDeps;
  private layout: WebTabsLayout = { tabs: [], pinned: [], groups: [], today: [], archived: [] };
  private version = 0;
  private sequence = 0;
  /** 壳报来、存进「本体」的图标（域名 → data: 地址）。 */
  private readonly remembered = new Map<string, string>();
  /** 演示图标开着没有（测试里关掉，SiteIcon 照首字母画）。 */
  icons = false;

  constructor(deps: FakeWebTabsDeps) {
    this.deps = deps;
  }

  /** 假服务端一开始就有的摆放（本地开发的演示；测试按需放）。 */
  seed(layout: WebTabsLayout): void {
    this.layout = normalizeLayout(layout);
    this.version = 1;
  }

  /** 测试看现在存着的。 */
  current(): WebTabsResponse {
    return { layout: this.layout, version: this.version };
  }

  async get(): Promise<WebTabsResponse> {
    this.deps.session.require();
    return this.current();
  }

  async put(input: PutWebTabsRequest): Promise<PutWebTabsResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('save', input.requestId, 'PUT /v2/web-tabs', () => {
      if (input.baseVersion !== this.version) {
        throw new ConflictError<WebTabsResponse>(this.current(), '竖排标签在别的设备上改过了，这次没有存。',
          '在 current 那一份上把这几步重做一遍，带它的 version 再送。');
      }
      this.save(input.layout);
      return { version: this.version };
    });
  }

  async merge(input: MergeWebTabsRequest): Promise<WebTabsResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('save', input.requestId, 'POST /v2/web-tabs/merge', () => {
      this.save(mergeLayouts(this.layout, input.layout, () => `merged-${(this.sequence += 1)}`));
      return this.current();
    });
  }

  async rememberIcon(input: PutFaviconRequest): Promise<PutFaviconResponse> {
    this.deps.session.require();
    const host = faviconHost(input.pageUrl);
    if (host === null) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, message: '这不是一个网站的图标，没有存。',
        field: 'pageUrl' });
    }
    this.remembered.set(host, input.icon);
    return { host };
  }

  faviconSrc(host: string): string | null {
    return this.remembered.get(host) ?? (this.icons ? demoFavicon(host) : null);
  }

  private save(layout: WebTabsLayout): void {
    const next = normalizeLayout(layout);
    if (sameLayout(next, this.layout)) {
      return;
    }
    this.layout = next;
    this.version += 1;
    this.deps.bus.emit({ type: 'webTabs.changed', version: this.version });
  }
}
