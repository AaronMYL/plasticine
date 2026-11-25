import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { ResolvedAddress } from './mail-image-fetch.ts';
import { isPrivateHost, URL_MAX_CHARS } from './urls.ts';

const PAGE_MAX_BYTES = 512 * 1024;
const ICON_MAX_BYTES = 100 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;
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
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  blocked?: (address: string) => boolean;
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

function scoreOf(rel: string, sizes: string, type: string): number {
  if (rel.includes('apple-touch-icon')) return 1;
  if (/\b32x32\b/.test(sizes)) return 6;
  if (/\b16x16\b/.test(sizes)) return 5;
  if (type.includes('svg') || sizes === 'any') return 4;
  if (sizes === '') return 3;
  return 2;
}

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
