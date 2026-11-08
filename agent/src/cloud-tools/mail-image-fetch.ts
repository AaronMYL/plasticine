// 邮件图片代理的取图一侧（用户 2026-11-04 定：外部图片服务器代为加载，对方看不到用户的 IP）。只取 http / https 的图片：
// - 防 SSRF：主机名先解析，解析出的地址里有本机、内网、链路本地（含云厂商元数据 169.254.x）、组播的一律拒绝；连接时
//   固定用核过的那个地址（不让 DNS 再解析一次落到内网）；重定向每一跳都重新核；
// - 只放 image/*（不放 SVG：它能带脚本，直接打开代理地址时会在本站跑），大小、时间有上限；
// - 不带 Referer、不带 cookie，User-Agent 是个通用的名字；
// - 按网址的 SHA-256 在内存里缓存（追踪像素只会被取一次，翻看同一封信不再出网）。

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isPrivateHost, URL_MAX_CHARS } from './urls.ts';

// 一张图最大 5 MiB：邮件里的图通常几十 KB，营销信的大横幅也在 1 MB 以内。
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// 一张图（含所有跳转）最多等 10 秒：iframe 里慢的图不该拖住整封信。
const IMAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;
// 内存缓存总量 64 MiB，最久没用的先丢。
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; PlasticineMailImage/1.0)';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/gif', 'image/webp',
  'image/avif', 'image/apng', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type MailImageErrorCode = 'refused' | 'not_image' | 'too_large' | 'failed';

export class MailImageError extends Error {
  readonly code: MailImageErrorCode;

  constructor(code: MailImageErrorCode, message: string) {
    super(message);
    this.name = 'MailImageError';
    this.code = code;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface MailImage {
  data: Buffer;
  type: string;
}

export interface MailImageFetchOptions {
  /** 主机名 → 地址（默认系统 DNS）；测试换成固定表。 */
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  /** 这个地址不许连（默认 isPrivateHost：本机、内网、链路本地、组播）。 */
  blocked?: (address: string) => boolean;
}

const systemResolve = async (host: string): Promise<ResolvedAddress[]> => lookup(host, { all: true });

function checkUrl(raw: string): URL {
  if (raw.length > URL_MAX_CHARS) {
    throw new MailImageError('refused', '图片网址太长，没有取。');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new MailImageError('refused', '图片网址不完整，没有取。');
    }
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MailImageError('refused', '只代取 http / https 的图片。');
  }
  if (url.username !== '' || url.password !== '') {
    throw new MailImageError('refused', '图片网址里带着账号，没有取。');
  }
  return url;
}

/** 连接只用核过的这个地址（Node 的连接会按 all: true 来问）。 */
function pinned(address: ResolvedAddress): LookupFunction {
  return (_host, options, callback) => {
    if (typeof options === 'object' && options !== null && 'all' in options && options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

function open(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<IncomingMessage> {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', signal, lookup: pinned(address),
      headers: { accept: 'image/*', 'accept-encoding': 'identity', 'user-agent': USER_AGENT } }, resolve);
    req.on('error', () => reject(new MailImageError('failed', '图片服务器连不上或断了。')));
    req.end();
  });
}

async function readBody(response: IncomingMessage): Promise<Buffer> {
  const declared = Number(response.headers['content-length'] ?? '0');
  if (declared > IMAGE_MAX_BYTES) {
    response.destroy();
    throw new MailImageError('too_large', '图片超过 5 MB，没有取。');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > IMAGE_MAX_BYTES) {
        throw new MailImageError('too_large', '图片超过 5 MB，没有取。');
      }
      chunks.push(buffer);
    }
  } finally {
    response.destroy();
  }
  return Buffer.concat(chunks);
}

export class MailImageFetcher {
  readonly #resolve: (host: string) => Promise<ResolvedAddress[]>;
  readonly #blocked: (address: string) => boolean;
  readonly #cache = new Map<string, MailImage>();
  #cached = 0;

  constructor(options: MailImageFetchOptions = {}) {
    this.#resolve = options.resolve ?? systemResolve;
    this.#blocked = options.blocked ?? isPrivateHost;
  }

  async #address(url: URL): Promise<ResolvedAddress> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (this.#blocked(host)) {
      throw new MailImageError('refused', '图片网址指向本机或内网，没有取。');
    }
    let addresses: ResolvedAddress[];
    try {
      addresses = await this.#resolve(host);
    } catch (error) {
      if (error instanceof Error) {
        throw new MailImageError('failed', '图片服务器的名字解析不了。');
      }
      throw error;
    }
    const first = addresses[0];
    if (first === undefined || addresses.some((entry) => this.#blocked(entry.address))) {
      throw new MailImageError('refused', '图片网址解析到了本机或内网，没有取。');
    }
    return first;
  }

  #remember(key: string, image: MailImage): void {
    this.#cache.set(key, image);
    this.#cached += image.data.length;
    for (const [oldest, entry] of this.#cache) {
      if (this.#cached <= CACHE_MAX_BYTES) {
        break;
      }
      this.#cache.delete(oldest);
      this.#cached -= entry.data.length;
    }
  }

  /** 取一张图；每一跳都核地址，最后一跳必须是 200 的图片。 */
  async get(raw: string, signal: AbortSignal): Promise<MailImage> {
    const key = createHash('sha256').update(raw).digest('hex');
    const hit = this.#cache.get(key);
    if (hit !== undefined) {
      this.#cache.delete(key);
      this.#cache.set(key, hit);
      return hit;
    }
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]);
    let url = checkUrl(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await open(url, await this.#address(url), deadline);
      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        response.destroy();
        const location = response.headers.location;
        if (location === undefined || hop === MAX_REDIRECTS) {
          throw new MailImageError('failed', '图片跳转太多次或没有目标。');
        }
        url = checkUrl(new URL(location, url).href);
        continue;
      }
      const type = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (status !== 200) {
        response.destroy();
        throw new MailImageError('failed', `图片服务器回了 ${status}。`);
      }
      if (!IMAGE_TYPES.has(type)) {
        response.destroy();
        throw new MailImageError('not_image', '这个网址回的不是图片，没有转。');
      }
      const image = { data: await readBody(response), type };
      this.#remember(key, image);
      return image;
    }
    throw new MailImageError('failed', '图片跳转没有完成。');
  }
}
