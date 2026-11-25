import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { checkPublicHttpsUrl, isPrivateHost } from '../cloud-tools/index.ts';
import { DailyError, shownError } from './errors.ts';
import { feedTitle, plain, tagAttributes } from './feed-parse.ts';
import { checkUrl } from './urls.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
type FeedRequest = (url: string, signal: AbortSignal) => Promise<Response>;

export function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DailyError('unreachable', '对方太久没回应（超时），过一会儿再试。'));
    work.then((value) => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
  });
}

const publicRequest: FeedRequest = async (raw, signal) => {
  const url = checkPublicHttpsUrl(raw);
  const addresses = await lookup(url.hostname, { all: true });
  signal.throwIfAborted();
  if (addresses.length === 0 || addresses.some((entry) => isPrivateHost(entry.address))) {
    throw shownError('invalid_input', '订阅地址解析到了内网，请换一个公开订阅地址。');
  }
  const address = addresses[0];
  if (address === undefined) {
    throw shownError('invalid_input', '订阅地址没有可连接的地址，请稍后再试。');
  }
  return new Promise<Response>((resolve, reject) => {
    const req = request({ hostname: address.address, family: address.family, servername: url.hostname,
      port: url.port || 443, path: url.pathname + url.search, signal,
      headers: { Host: url.host, 'Accept-Encoding': 'identity', 'User-Agent': 'Plasticine RSS' } }, (res) => {
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) {
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
        }
        const stream = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        const status = res.statusCode ?? 502;
        const noBody = [204, 205, 304].includes(status);
        if (noBody) { res.resume(); }
        resolve(new Response(noBody ? null : stream, { status, headers }));
      } catch {
        res.destroy();
        reject(shownError('invalid_input', '订阅响应无法读取，请检查地址。'));
      }
    });
    req.on('error', () => reject(new DailyError('unreachable', '连不上这个网站（连接被断开），过一会儿再试。')));
    req.end();
  });
};

export class FeedFetcher {
  readonly #request: FeedRequest;
  constructor(options: { request?: FeedRequest } = {}) { this.#request = options.request ?? publicRequest; }

  async get(raw: string, signal: AbortSignal): Promise<{ text: string; url: string }> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
    let url = checkUrl(checkPublicHttpsUrl(raw).href);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      deadline.throwIfAborted();
      const response = await bounded(this.#request(url, deadline), deadline);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (response.body !== null) { await bounded(response.body.cancel(), deadline); }
        const location = response.headers.get('location');
        if (location === null || hop === MAX_REDIRECTS) {
          throw shownError('invalid_input', '订阅跳转超过三次或缺少目标，请改用最终订阅地址。');
        }
        url = checkUrl(checkPublicHttpsUrl(new URL(location, url).href).href);
        continue;
      }
      if (!response.ok || response.body === null) {
        if (response.body !== null) { await bounded(response.body.cancel(), deadline); }
        if (response.status === 429) {
          throw new DailyError('rate_limited', '对方限流了（请求太频繁），稍后自动再试。');
        }
        if (response.status === 404) {
          throw shownError('invalid_input', '地址打不开（404），请检查名字或地址。');
        }
        if (response.status === 401 || response.status === 403) {
          throw new DailyError('unreachable', `这个网站拒绝了服务器的访问（${String(response.status)}）。`);
        }
        if (response.status >= 500) {
          throw new DailyError('unreachable', `这个网站出错了（${String(response.status)}），过一会儿再试。`);
        }
        throw shownError('invalid_input', '订阅没有返回可读内容，请检查地址后再试。');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          deadline.throwIfAborted();
          const next = await bounded(reader.read(), deadline);
          if (next.done) {
            break;
          }
          bytes += next.value.byteLength;
          if (bytes > MAX_BYTES) {
            throw shownError('invalid_input', '订阅响应超过 2 MB，请使用更小的订阅源。');
          }
          chunks.push(next.value);
        }
        return { text: Buffer.concat(chunks).toString('utf8'), url };
      } finally {
        await bounded(reader.cancel(), deadline);
      }
    }
    throw shownError('invalid_input', '订阅跳转没有完成，请检查地址。');
  }

  async discover(raw: string, signal: AbortSignal): Promise<DiscoveredFeed> {
    const page = await this.get(raw, signal);
    if (looksLikeFeed(page.text)) {
      return { url: page.url, title: titleOf(page.text) };
    }
    const declared = feedLinkIn(page.text, page.url);
    if (declared !== null) { return declared; }
    for (const candidate of commonFeedUrls(page.url)) {
      signal.throwIfAborted();
      let found: { text: string; url: string };
      try {
        found = await this.get(candidate, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof DailyError)) { throw error; }
        continue;
      }
      if (looksLikeFeed(found.text)) {
        return { url: found.url, title: titleOf(found.text) ?? titleOf(page.text) };
      }
    }
    throw new DailyError('no_feed', '这个网站没有订阅源');
  }
}

export interface DiscoveredFeed {
  url: string;
  title: string | null;
}

const COMMON_FEED_PATHS = ['feed', 'rss', 'feed.xml', 'rss.xml', 'atom.xml', 'index.xml'];
const COMMON_FEED_TRIES = 8;

export function feedLinkIn(html: string, pageUrl: string): DiscoveredFeed | null {
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = tagAttributes(tag[0]);
    if ((attrs['rel'] ?? '').toLowerCase().split(/\s+/).includes('alternate')
      && /^application\/(rss|atom)\+xml$/i.test(attrs['type'] ?? '') && attrs['href']) {
      const url = checkUrl(checkPublicHttpsUrl(new URL(attrs['href'], pageUrl).href).href);
      return { url, title: siteName(html) ?? (attrs['title']?.trim() || null) };
    }
  }
  return null;
}

export function looksLikeFeed(text: string): boolean {
  return /<(?:rss|feed)(?:\s|>)/i.test(text);
}

function titleOf(text: string): string | null {
  if (looksLikeFeed(text)) {
    try {
      return feedTitle(text);
    } catch (error) {
      if (!(error instanceof DailyError)) { throw error; }
      return null;
    }
  }
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const title = match === null ? '' : plain(match[1] ?? '').slice(0, 200);
  return title === '' ? null : title;
}

function siteName(html: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tagAttributes(tag[0]);
    if ((attrs['property'] ?? attrs['name'])?.toLowerCase() === 'og:site_name' && attrs['content']?.trim()) {
      return plain(attrs['content']).slice(0, 200);
    }
  }
  return titleOf(html);
}

export function commonFeedUrls(pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const directory = new URL('./', page);
  const bases = [directory.href, `${page.origin}/`];
  const urls = bases.flatMap((base) => COMMON_FEED_PATHS.map((path) => new URL(path, base).href));
  return [...new Set(urls)].slice(0, COMMON_FEED_TRIES);
}
