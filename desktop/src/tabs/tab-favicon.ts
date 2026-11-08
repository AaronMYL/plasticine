// 网页标签的网站图标（11-08 他要标签显示真的网站图标）：页面报了图标地址（page-favicon-updated），用标签自己的
// session（带着登录）取第一个能用的，只收图片类型、最多 64 KB，转成 data: 地址交给界面（desktop-bridge.ts 的
// WebTabIconEvent）。同一个地址取过就记住，不重复取；取不到不报（界面照旧用首字母）。

import type { Session } from 'electron';
import { WEB_TAB_ICON_MAX_BYTES, WEB_TAB_ICON_TYPES,
  type WebTabIconEvent } from '../../../agent/shared/api/desktop-bridge.ts';
import type { Tab } from './tab-views.ts';

/** 记住这么多个图标地址就从最早的开始忘。 */
const CACHE_MAX = 500;
const FETCH_TIMEOUT_MS = 10_000;
/** 一次最多试这么多个候选地址。 */
const CANDIDATES_MAX = 3;

/** 响应头的类型不可靠时按地址后缀认。 */
export function iconType(contentType: string | null, url: string): string | null {
  const declared = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if ((WEB_TAB_ICON_TYPES as readonly string[]).includes(declared)) {
    return declared;
  }
  const path = url.split(/[?#]/)[0]?.toLowerCase() ?? '';
  const byExtension: Readonly<Record<string, string>> = { '.ico': 'image/x-icon', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  const extension = Object.keys(byExtension).find((suffix) => path.endsWith(suffix));
  return extension === undefined ? null : byExtension[extension] ?? null;
}

export function iconDataUrl(bytes: Uint8Array, type: string): string | null {
  if (bytes.length === 0 || bytes.length > WEB_TAB_ICON_MAX_BYTES) {
    return null;
  }
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}

export class TabFavicons {
  private readonly session: Session;
  private readonly emit: (event: WebTabIconEvent) => void;
  private readonly log: (line: string) => void;
  private readonly cache = new Map<string, string | null>();

  constructor(session: Session, emit: (event: WebTabIconEvent) => void, log: (line: string) => void) {
    this.session = session;
    this.emit = emit;
    this.log = log;
  }

  update(tab: Tab, urls: readonly string[]): void {
    const pageUrl = tab.view.webContents.getURL();
    void this.first(urls.filter((url) => /^(https?|data):/i.test(url)).slice(0, CANDIDATES_MAX)).then((icon) => {
      if (icon !== null && !tab.view.webContents.isDestroyed() && tab.view.webContents.getURL() === pageUrl) {
        this.emit({ type: 'icon', tabId: tab.id, pageUrl, icon });
      }
    });
  }

  private async first(urls: readonly string[]): Promise<string | null> {
    for (const url of urls) {
      const icon = await this.fetch(url);
      if (icon !== null) {
        return icon;
      }
    }
    return null;
  }

  private async fetch(url: string): Promise<string | null> {
    const known = this.cache.get(url);
    if (known !== undefined) {
      return known;
    }
    let icon: string | null = null;
    try {
      const response = await this.session.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const type = iconType(response.headers.get('content-type'), url);
      if (response.ok && type !== null) {
        icon = iconDataUrl(new Uint8Array(await response.arrayBuffer()), type);
      }
    } catch (error) {
      this.log(`网站图标没取到：${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(url, icon);
    return icon;
  }
}
