// 网站图标的缓存规则：库里有、没过期就直接用；没有或过期了才去网站取（同一个域名同时只取一次）。
// 取到了留 14 天；网站没有图标或取不到，记一笔「没有」留 1 天再试；原来有、这次没取到的，旧图标照用、1 天后再试。

import { FaviconFetchError, type FaviconFetcher } from '../cloud-tools/favicon-fetch.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { CachedFavicon, FaviconStore } from '../state/index.ts';

/** 取到的图标留 14 天：网站换图标不常见，两周内换了也只是晚几天看到。 */
const FOUND_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** 没取到的 1 天后再试：网站临时打不开时不至于一直是首字母。 */
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;

export interface FaviconCacheOptions {
  store: FaviconStore;
  fetcher: FaviconFetcher;
  now: () => Date;
}

export class FaviconCache {
  readonly #options: FaviconCacheOptions;
  readonly #inFlight = new Map<string, Promise<CachedFavicon>>();

  constructor(options: FaviconCacheOptions) {
    this.#options = options;
  }

  /** 这个域名的图标（可能是「没有」）。 */
  async icon(host: string): Promise<CachedFavicon> {
    const cached = this.#options.store.get(host);
    if (cached !== null && Date.parse(cached.expiresAt) > this.#options.now().getTime()) {
      return cached;
    }
    const running = this.#inFlight.get(host);
    if (running !== undefined) {
      return running;
    }
    const work = this.#refresh(host, cached).finally(() => this.#inFlight.delete(host));
    this.#inFlight.set(host, work);
    return work;
  }

  /** 桌面壳报来的（页面自己的图标）：直接记成取到了，留 14 天。 */
  remember(host: string, image: { mime: string; data: Uint8Array }): void {
    const now = this.#options.now();
    this.#options.store.put(host, { status: 'ok', mime: image.mime, data: image.data, fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + FOUND_TTL_MS).toISOString() });
  }

  async #refresh(host: string, previous: CachedFavicon | null): Promise<CachedFavicon> {
    const now = this.#options.now();
    const fetchedAt = now.toISOString();
    let entry: CachedFavicon;
    try {
      // 浏览器不等了也取完：结果进缓存，下一次画标签就有了。
      const image = await this.#options.fetcher.get(host, new AbortController().signal);
      entry = image === null
        ? { status: 'none', fetchedAt, expiresAt: new Date(now.getTime() + MISSING_TTL_MS).toISOString() }
        : { status: 'ok', mime: image.mime, data: image.data, fetchedAt,
          expiresAt: new Date(now.getTime() + FOUND_TTL_MS).toISOString() };
    } catch (cause) {
      if (!(cause instanceof FaviconFetchError) && !(cause instanceof Error && cause.name === 'AbortError')
        && !(cause instanceof Error && cause.name === 'TimeoutError')) {
        throw cause;
      }
      safeLog('warn', 'favicon_failed', { category: errorCategory(cause) });
      const retry = new Date(now.getTime() + MISSING_TTL_MS).toISOString();
      entry = previous?.status === 'ok' ? { ...previous, expiresAt: retry }
        : { status: 'none', fetchedAt, expiresAt: retry };
    }
    this.#options.store.put(host, entry);
    return entry;
  }
}
