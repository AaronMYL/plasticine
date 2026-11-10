// 邮件图片和链接预览共用的公网请求：逐跳核地址、固定DNS结果、限时限量，不带用户身份或来源。
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isPrivateHost, URL_MAX_CHARS } from './urls.ts';

const MAX_REDIRECTS = 4;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type PublicFetchErrorCode = 'refused' | 'content_type' | 'too_large' | 'failed' | 'timeout';
export class PublicFetchError extends Error {
  readonly code: PublicFetchErrorCode;
  constructor(code: PublicFetchErrorCode, message: string) {
    super(message);
    this.name = 'PublicFetchError';
    this.code = code;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}
export interface PublicFetchOptions {
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  blocked?: (address: string) => boolean;
}
export interface PublicRequest {
  accept: string;
  types: ReadonlySet<string>;
  maxBytes: number;
  timeoutMs: number;
  userAgent: string;
}
export interface PublicResource {
  url: URL;
  data: Buffer;
  type: string;
  contentType: string;
}

export function publicUrl(raw: string): URL {
  if (raw.length > URL_MAX_CHARS || !URL.canParse(raw)) {
    throw new PublicFetchError('refused', '网址不完整或太长，没有读取。');
  }
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new PublicFetchError('refused', '只读取不带账号密码的 http / https 网址。');
  }
  url.hash = '';
  return url;
}

/** DNS 本身也受总时限约束；移除监听，避免完成后的请求留在信号上。 */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function pinned(address: ResolvedAddress): LookupFunction {
  return (_host, options, callback) => {
    if (typeof options === 'object' && options !== null && 'all' in options && options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

async function body(response: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    if (Number(response.headers['content-length'] ?? '0') > maxBytes) {
      throw new PublicFetchError('too_large', '远程内容太大，没有读取。');
    }
    for await (const chunk of response) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > maxBytes) throw new PublicFetchError('too_large', '远程内容太大，没有读取。');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally { response.destroy(); }
}

export class PublicFetcher {
  readonly #resolve: (host: string) => Promise<ResolvedAddress[]>;
  readonly #blocked: (address: string) => boolean;

  constructor(options: PublicFetchOptions = {}) {
    this.#resolve = options.resolve ?? ((host) => lookup(host, { all: true }));
    this.#blocked = options.blocked ?? isPrivateHost;
  }

  async #address(url: URL, signal: AbortSignal): Promise<ResolvedAddress> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (this.#blocked(host)) throw new PublicFetchError('refused', '网址指向本机或内网，没有读取。');
    const addresses = await abortable(this.#resolve(host), signal);
    const first = addresses[0];
    if (first === undefined || addresses.some((entry) => this.#blocked(entry.address))) {
      throw new PublicFetchError('refused', '网址解析到了本机或内网，没有读取。');
    }
    return first;
  }

  async #open(url: URL, spec: PublicRequest, signal: AbortSignal): Promise<IncomingMessage> {
    const address = await this.#address(url, signal);
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = request(url, { method: 'GET', signal, lookup: pinned(address), agent: false,
        headers: { accept: spec.accept, 'accept-encoding': 'identity', 'user-agent': spec.userAgent } }, resolve);
      req.on('error', reject);
      req.end();
    });
  }

  async get(raw: string, spec: PublicRequest, signal: AbortSignal): Promise<PublicResource> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]);
    let url = publicUrl(raw);
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const response = await this.#open(url, spec, deadline);
        const status = response.statusCode ?? 0;
        if (REDIRECTS.has(status)) {
          response.destroy();
          const next = response.headers.location;
          if (next === undefined || !URL.canParse(next, url.href)) break;
          url = publicUrl(new URL(next, url).href);
          continue;
        }
        const contentType = response.headers['content-type'] ?? '';
        const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
        if (status !== 200 || !spec.types.has(type)) {
          response.destroy();
          throw new PublicFetchError(status === 200 ? 'content_type' : 'failed',
            status === 200 ? '远程内容类型不支持，没有读取。' : `远程服务器回了 ${status}。`);
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          response.destroy();
          throw new PublicFetchError('content_type', '远程服务器返回了压缩内容，没有读取。');
        }
        return { url, type, contentType, data: await body(response, spec.maxBytes) };
      }
      throw new PublicFetchError('failed', '网页跳转过多或没有目标。');
    } catch (cause) {
      if (signal.aborted) throw signal.reason;
      if (deadline.aborted) throw new PublicFetchError('timeout', '远程服务器读取超时，请稍后再试。');
      if (cause instanceof PublicFetchError) throw cause;
      throw new PublicFetchError('failed', '远程服务器连不上或连接中断，请稍后再试。');
    }
  }
}
