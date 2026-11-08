// 每跳校验 https 公网 URL；DNS 地址固定到本次连接，禁止重解析落到内网。
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { checkPublicHttpsUrl, isPrivateHost } from '../cloud-tools/index.ts';
import { DailyError } from './errors.ts';
import { feedTitle, plain, tagAttributes } from './feed-parse.ts';
import { cleanUrl } from './urls.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
type FeedRequest = (url: string, signal: AbortSignal) => Promise<Response>;

// DNS、响应头和正文共用一个总截止时间；注入的传输即使忽略 signal，也不会无限等下去。
export function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DailyError('invalid_input', '信息流抓取或选材超时或已取消，请稍后再试。'));
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
    throw new DailyError('invalid_input', '订阅地址解析到了内网，请换一个公开订阅地址。');
  }
  const address = addresses[0];
  if (address === undefined) {
    throw new DailyError('invalid_input', '订阅地址没有可连接的地址，请稍后再试。');
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
        reject(new DailyError('invalid_input', '订阅响应无法读取，请检查地址。'));
      }
    });
    req.on('error', () => reject(new DailyError('invalid_input', '订阅抓取失败，请稍后再试。')));
    req.end();
  });
};

export class FeedFetcher {
  readonly #request: FeedRequest;
  constructor(options: { request?: FeedRequest } = {}) { this.#request = options.request ?? publicRequest; }

  async get(raw: string, signal: AbortSignal): Promise<{ text: string; url: string }> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
    let url = cleanUrl(checkPublicHttpsUrl(raw).href);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      deadline.throwIfAborted();
      const response = await bounded(this.#request(url, deadline), deadline);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (response.body !== null) { await bounded(response.body.cancel(), deadline); }
        const location = response.headers.get('location');
        if (location === null || hop === MAX_REDIRECTS) {
          throw new DailyError('invalid_input', '订阅跳转超过三次或缺少目标，请改用最终订阅地址。');
        }
        url = cleanUrl(checkPublicHttpsUrl(new URL(location, url).href).href);
        continue;
      }
      if (!response.ok || response.body === null) {
        if (response.body !== null) { await bounded(response.body.cancel(), deadline); }
        throw new DailyError('invalid_input', '订阅没有返回可读内容，请检查地址后再试。');
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
            throw new DailyError('invalid_input', '订阅响应超过 2 MB，请使用更小的订阅源。');
          }
          chunks.push(next.value);
        }
        return { text: Buffer.concat(chunks).toString('utf8'), url };
      } finally {
        await bounded(reader.cancel(), deadline);
      }
    }
    throw new DailyError('invalid_input', '订阅跳转没有完成，请检查地址。');
  }

  /**
   * 他给一个网址，自己找订阅地址（第 3 批 11-04）：本身就是订阅源就用它；页面里声明了 alternate 订阅就用声明的；
   * 都没有再试几个常见路径（先按页面所在目录、再按站点根目录），第一个像订阅源的就是。名字取订阅源或页面的标题。
   */
  async discover(raw: string, signal: AbortSignal): Promise<DiscoveredFeed> {
    const page = await this.get(raw, signal);
    if (looksLikeFeed(page.text)) {
      return { url: page.url, title: titleOf(page.text) };
    }
    for (const tag of page.text.matchAll(/<link\b[^>]*>/gi)) {
      const attrs = tagAttributes(tag[0]);
      if ((attrs['rel'] ?? '').toLowerCase().split(/\s+/).includes('alternate')
        && /^application\/(rss|atom)\+xml$/i.test(attrs['type'] ?? '') && attrs['href']) {
        const url = cleanUrl(checkPublicHttpsUrl(new URL(attrs['href'], page.url).href).href);
        return { url, title: attrs['title']?.trim() || titleOf(page.text) };
      }
    }
    for (const candidate of commonFeedUrls(page.url)) {
      signal.throwIfAborted();
      let found: { text: string; url: string };
      try {
        found = await this.get(candidate, signal);
      } catch (error) {
        // 这条常见路径没有（404、不是 https、太大）就试下一条；整体取消或超时照常抛出。
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
  /** 订阅源或页面自己的名字；都没有就是 null，由调用方用网站名。 */
  title: string | null;
}

// 常见的订阅路径（WordPress、Ghost、Hugo、Jekyll、Substack 等的默认值）；最多试这么几个，不在一个网站上乱撞。
const COMMON_FEED_PATHS = ['feed', 'rss', 'feed.xml', 'rss.xml', 'atom.xml', 'index.xml'];
const COMMON_FEED_TRIES = 8;

function looksLikeFeed(text: string): boolean {
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

export function commonFeedUrls(pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const directory = new URL('./', page);
  const bases = [directory.href, `${page.origin}/`];
  const urls = bases.flatMap((base) => COMMON_FEED_PATHS.map((path) => new URL(path, base).href));
  return [...new Set(urls)].slice(0, COMMON_FEED_TRIES);
}
