// 邮件图片代理的取图一侧（用户 2026-11-04 定：外部图片服务器代为加载，对方看不到用户的 IP）。只取 http / https 的图片：
// - 防 SSRF：主机名先解析，解析出的地址里有本机、内网、链路本地（含云厂商元数据 169.254.x）、组播的一律拒绝；连接时
//   固定用核过的那个地址（不让 DNS 再解析一次落到内网）；重定向每一跳都重新核；
// - 只放 image/*（不放 SVG：它能带脚本，直接打开代理地址时会在本站跑），大小、时间有上限；
// - 不带 Referer、不带 cookie，User-Agent 是个通用的名字；
// - 按网址的 SHA-256 在内存里缓存（追踪像素只会被取一次，翻看同一封信不再出网）。

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
