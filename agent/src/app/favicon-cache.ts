import { FaviconFetchError, type FaviconFetcher } from '../cloud-tools/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import type { CachedFavicon, FaviconStore } from '../state/index.ts';

const FOUND_TTL_MS = 14 * 24 * 60 * 60 * 1000;
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
