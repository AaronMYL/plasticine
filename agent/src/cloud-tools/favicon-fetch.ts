// 网站图标的代取（11-08 他定「网页的标签要能够显示对应网站的图标」；不用第三方图标服务，免得把他看了哪些网站发出去）。
// 按域名去那个网站自己取：先读首页 <head> 里的 <link rel="icon">，挑最合适的一个；没有或取不到再试 /favicon.ico。
// 和邮件图片代理同一套防 SSRF 的做法（mail-image-fetch.ts）：只走 http(s)；主机名先解析，解析出的地址里有本机、内网、
// 链路本地、组播的一律拒绝；连接固定用核过的地址；每一跳重定向都重新核。首页最多读 512 KB，图标最多 100 KB，
// 整个过程最多 8 秒。图标的种类按字节认（不信对方的 content-type），只收 PNG / ICO / GIF / JPEG / WebP / SVG。

import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { ResolvedAddress } from './mail-image-fetch.ts';
import { isPrivateHost, URL_MAX_CHARS } from './urls.ts';

/** 首页只为读 <head>：再大的页面前 512 KB 里也有。 */
const PAGE_MAX_BYTES = 512 * 1024;
/** 一个图标最多 100 KB（常见的 16–64 px 图标几 KB；apple-touch-icon 也在几十 KB）。 */
const ICON_MAX_BYTES = 100 * 1024;
/** 整个取图标（首页 + 几个候选 + 跳转）最多等 8 秒。 */
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;
/** 候选图标最多试这么多个（含 /favicon.ico）。 */
const MAX_CANDIDATES = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; PlasticineFavicon/1.0)';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class FaviconFetchError extends Error {
  readonly code: 'refused' | 'failed';

  constructor(code: 'refused' | 'failed', message: string) {
    super(message);
    this.name = 'FaviconFetchError';
    this.code = code;
  }
}

export interface FaviconImage {
  mime: string;
  data: Uint8Array;
}

export interface FaviconFetchOptions {
  /** 主机名 → 地址（默认系统 DNS）；测试换成固定表。 */
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  /** 这个地址不许连（默认 isPrivateHost：本机、内网、链路本地、组播）。 */
  blocked?: (address: string) => boolean;
  /** 从哪几个首页地址试（默认 https://域名/，不通再 http://域名/）；测试给带端口的本机地址。 */
  pages?: (host: string) => string[];
}

const systemResolve = async (host: string): Promise<ResolvedAddress[]> => lookup(host, { all: true });

function pinned(address: ResolvedAddress): LookupFunction {
  return (_host, options, callback) => {
    if (typeof options === 'object' && options !== null && 'all' in options && options.all === true) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

function checkUrl(raw: string): URL {
  if (raw.length > URL_MAX_CHARS) {
    throw new FaviconFetchError('refused', '图标网址太长，没有取。');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    if (cause instanceof TypeError) throw new FaviconFetchError('failed', '图标网址不完整，没有取。');
    throw cause;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FaviconFetchError('refused', '只取 http / https 的图标。');
  }
  if (url.username !== '' || url.password !== '') {
    throw new FaviconFetchError('refused', '图标网址里带着账号，没有取。');
  }
  return url;
}

/** 按开头几个字节认图片种类；认不出是 null。 */
export function sniffImage(data: Uint8Array): string | null {
  const at = (index: number): number => data[index] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0x00 && at(1) === 0x00 && (at(2) === 0x01 || at(2) === 0x02) && at(3) === 0x00) return 'image/x-icon';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45)
    return 'image/webp';
  const head = new TextDecoder().decode(data.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

interface IconLink {
  href: string;
  score: number;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? match[3] ?? '').trim();
}

/** 16px 显示：32×32 最合适，其次 16×16、SVG、没写尺寸的；apple-touch-icon 大但也能用，排最后。 */
function scoreOf(rel: string, sizes: string, type: string): number {
  if (rel.includes('apple-touch-icon')) return 1;
  if (/\b32x32\b/.test(sizes)) return 6;
  if (/\b16x16\b/.test(sizes)) return 5;
  if (type.includes('svg') || sizes === 'any') return 4;
  if (sizes === '') return 3;
  return 2;
}

/** 首页里的图标链接，按合适程度排；相对地址按页面地址解开。 */
export function iconLinks(html: string, page: URL): string[] {
  const head = html.slice(0, html.search(/<\/head>/i) === -1 ? html.length : html.search(/<\/head>/i));
  const links: IconLink[] = [];
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase();
    const href = attribute(tag, 'href');
    if (href === null || href === '' || !/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)
      || rel.includes('mask-icon')) {
      continue;
    }
    let resolved: string;
    try {
      resolved = new URL(href, page).href;
    } catch (cause) {
      if (cause instanceof TypeError) continue;
      throw cause;
    }
    links.push({ href: resolved, score: scoreOf(rel, (attribute(tag, 'sizes') ?? '').toLowerCase(),
      (attribute(tag, 'type') ?? '').toLowerCase()) });
  }
  return links.sort((a, b) => b.score - a.score).map((link) => link.href);
}

/** data: 地址里的字节；不是 data: 或超过 100 KB 是 null。 */
export function decodeDataUrl(raw: string): Uint8Array | null {
  const match = /^data:[^,;]*(;base64)?,(.*)$/is.exec(raw);
  if (match === null) return null;
  const body = match[2] ?? '';
  const bytes = match[1] === undefined ? Buffer.from(decodeURIComponent(body)) : Buffer.from(body, 'base64');
  return bytes.length > ICON_MAX_BYTES ? null : new Uint8Array(bytes);
}

export class FaviconFetcher {
  readonly #resolve: (host: string) => Promise<ResolvedAddress[]>;
  readonly #blocked: (address: string) => boolean;
  readonly #pages: (host: string) => string[];

  constructor(options: FaviconFetchOptions = {}) {
    this.#resolve = options.resolve ?? systemResolve;
    this.#blocked = options.blocked ?? isPrivateHost;
    this.#pages = options.pages ?? ((host) => [`https://${host}/`, `http://${host}/`]);
  }

  async #address(url: URL): Promise<ResolvedAddress> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (this.#blocked(host)) {
      throw new FaviconFetchError('refused', '网址指向本机或内网，没有取。');
    }
    let addresses: ResolvedAddress[];
    try {
      addresses = await this.#resolve(host);
    } catch (cause) {
      if (cause instanceof Error) throw new FaviconFetchError('failed', '网站的名字解析不了。');
      throw cause;
    }
    const first = addresses[0];
    if (first === undefined || addresses.some((entry) => this.#blocked(entry.address))) {
      throw new FaviconFetchError('refused', '网址解析到了本机或内网，没有取。');
    }
    return first;
  }

  async #open(url: URL, accept: string, signal: AbortSignal): Promise<IncomingMessage> {
    const address = await this.#address(url);
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = request(url, { method: 'GET', signal, lookup: pinned(address),
        headers: { accept, 'accept-encoding': 'identity', 'user-agent': USER_AGENT } }, resolve);
      req.on('error', () => reject(new FaviconFetchError('failed', '网站连不上或断了。')));
      req.end();
    });
  }

  /** GET 一个地址，跟着跳转（每一跳都核），读到 limit 为止；不是 200 抛错。回最后的地址和字节。 */
  async #get(raw: string, accept: string, limit: number, truncate: boolean, signal: AbortSignal)
    : Promise<{ url: URL; data: Uint8Array }> {
    let url = checkUrl(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await this.#open(url, accept, signal);
      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        response.destroy();
        const location = response.headers.location;
        if (location === undefined) break;
        url = checkUrl(URL.canParse(location, url.href) ? new URL(location, url).href : '');
        continue;
      }
      if (status !== 200) {
        response.destroy();
        throw new FaviconFetchError('failed', `网站回了 ${status}。`);
      }
      return { url, data: await readUpTo(response, limit, truncate) };
    }
    throw new FaviconFetchError('failed', '跳转太多次或没有目标。');
  }

  async #icon(candidate: string, signal: AbortSignal): Promise<FaviconImage | null> {
    const data = candidate.startsWith('data:') ? decodeDataUrl(candidate)
      : (await this.#get(candidate, 'image/*', ICON_MAX_BYTES, false, signal)).data;
    if (data === null || data.length === 0) return null;
    const mime = sniffImage(data);
    return mime === null ? null : { mime, data };
  }

  /** 取这个域名的图标；网站没有图标是 null；连不上、被拒抛 FaviconFetchError。 */
  async get(host: string, signal: AbortSignal): Promise<FaviconImage | null> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
    let page: { url: URL; data: Uint8Array } | null = null;
    let lastError: unknown = null;
    for (const address of this.#pages(host)) {
      try {
        page = await this.#get(address, 'text/html', PAGE_MAX_BYTES, true, deadline);
        break;
      } catch (cause) {
        if (!(cause instanceof FaviconFetchError) || cause.code === 'refused') throw cause;
        lastError = cause;
      }
    }
    if (page === null) {
      throw lastError instanceof Error ? lastError : new FaviconFetchError('failed', '网站打不开。');
    }
    const html = new TextDecoder().decode(page.data);
    const links = iconLinks(html, page.url).slice(0, MAX_CANDIDATES - 1);
    const candidates = [...new Set([...links, new URL('/favicon.ico', page.url).href])];
    for (const candidate of candidates) {
      try {
        const icon = await this.#icon(candidate, deadline);
        if (icon !== null) return icon;
      } catch (cause) {
        if (!(cause instanceof FaviconFetchError) || deadline.aborted) throw cause;
      }
    }
    return null;
  }
}

async function readUpTo(response: IncomingMessage, limit: number, truncate: boolean): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limit) {
        if (!truncate) throw new FaviconFetchError('failed', '图标太大，没有取。');
        chunks.push(buffer.subarray(0, buffer.length - (size - limit)));
        break;
      }
      chunks.push(buffer);
    }
  } finally {
    response.destroy();
  }
  return new Uint8Array(Buffer.concat(chunks));
}
