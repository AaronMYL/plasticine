import { createHash } from 'node:crypto';
import { PublicFetcher, PublicFetchError, type PublicFetchOptions } from './public-fetch.ts';
export type { ResolvedAddress } from './public-fetch.ts';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/gif', 'image/webp',
  'image/avif', 'image/apng', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon']);

export type MailImageErrorCode = 'refused' | 'not_image' | 'too_large' | 'failed';
export class MailImageError extends Error {
  readonly code: MailImageErrorCode;
  constructor(code: MailImageErrorCode, message: string) {
    super(message);
    this.name = 'MailImageError';
    this.code = code;
  }
}
export interface MailImage { data: Buffer; type: string }
export type MailImageFetchOptions = PublicFetchOptions;

export class MailImageFetcher {
  readonly #fetcher: PublicFetcher;
  readonly #cache = new Map<string, MailImage>();
  #cached = 0;

  constructor(options: MailImageFetchOptions = {}) {
    this.#fetcher = new PublicFetcher(options);
  }

  #remember(key: string, image: MailImage): void {
    this.#cache.set(key, image);
    this.#cached += image.data.length;
    for (const [oldest, entry] of this.#cache) {
      if (this.#cached <= CACHE_MAX_BYTES) break;
      this.#cache.delete(oldest);
      this.#cached -= entry.data.length;
    }
  }

  async get(raw: string, signal: AbortSignal): Promise<MailImage> {
    const key = createHash('sha256').update(raw).digest('hex');
    const hit = this.#cache.get(key);
    if (hit !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, hit);
      return hit;
    }
    try {
      const result = await this.#fetcher.get(raw, { accept: 'image/*', types: IMAGE_TYPES,
        maxBytes: IMAGE_MAX_BYTES, timeoutMs: IMAGE_TIMEOUT_MS,
        userAgent: 'Mozilla/5.0 (compatible; PlasticineMailImage/1.0)' }, signal);
      const image = { data: result.data, type: result.type };
      this.#remember(key, image);
      return image;
    } catch (cause) {
      if (!(cause instanceof PublicFetchError)) throw cause;
      const codes = { refused: 'refused', content_type: 'not_image', too_large: 'too_large',
        failed: 'failed', timeout: 'failed' } as const;
      throw new MailImageError(codes[cause.code], cause.message);
    }
  }
}
