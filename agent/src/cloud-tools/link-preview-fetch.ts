// 链接卡只读网页头部的标题和摘要；正文不执行、不保存。图片继续走邮件图片代理。
import type { LinkPreview } from '../../shared/api/link-preview.ts';
import { decodeEntities } from './mail-html-text.ts';
import { PublicFetcher, publicUrl, type PublicFetchOptions } from './public-fetch.ts';
import { isPrivateHost, URL_MAX_CHARS } from './urls.ts';

const MAX_HTML_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const CACHE_MS = 10 * 60_000;
const CACHE_ENTRIES = 256;
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export interface LinkPreviewFetchOptions extends PublicFetchOptions {
  timeoutMs?: number;
  now?: () => number;
}

function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return found === null ? null : decodeEntities(found[1] ?? found[2] ?? found[3] ?? '').trim();
}

function text(value: string, limit: number): string {
  return decodeEntities(value).replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

function metadata(html: string, url: URL): LinkPreview {
  const head = html.split(/<\/head\s*>/i)[0] ?? '';
  const clean = head.replace(/<!--[^]*?(?:-->|$)/g, '')
    .replace(/<(script|style|noscript)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, '');
  const meta = new Map<string, string>();
  for (const match of clean.matchAll(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const name = (attribute(match[0], 'property') ?? attribute(match[0], 'name') ?? '').toLowerCase();
    const value = attribute(match[0], 'content');
    if (value !== null && !meta.has(name)) meta.set(name, value);
  }
  const fallback = /<title\b[^>]*>([^]*?)<\/title\s*>/i.exec(clean)?.[1] ?? url.hostname;
  const rawImage = meta.get('og:image') ?? meta.get('twitter:image') ?? '';
  let image: string | null = null;
  if (rawImage !== '' && URL.canParse(rawImage, url.href)) {
    const candidate = new URL(rawImage, url);
    if (['http:', 'https:'].includes(candidate.protocol) && candidate.username === '' && candidate.password === ''
      && candidate.href.length <= URL_MAX_CHARS && !isPrivateHost(candidate.hostname)) image = candidate.href;
  }
  return { url: url.href, title: text(meta.get('og:title') ?? meta.get('twitter:title') ?? fallback, 300),
    site: text(meta.get('og:site_name') ?? url.hostname, 200), image,
    description: text(meta.get('og:description') ?? meta.get('description') ?? '', 600) };
}

export class LinkPreviewFetcher {
  readonly #fetcher: PublicFetcher;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #cache = new Map<string, { at: number; preview: LinkPreview }>();

  constructor(options: LinkPreviewFetchOptions = {}) {
    this.#fetcher = new PublicFetcher(options);
    this.#timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
  }

  async get(raw: string, signal: AbortSignal): Promise<LinkPreview> {
    const key = publicUrl(raw).href;
    const cached = this.#cache.get(key);
    if (cached !== undefined && this.#now() - cached.at < CACHE_MS) return cached.preview;
    const page = await this.#fetcher.get(key, { accept: 'text/html,application/xhtml+xml', types: HTML_TYPES,
      maxBytes: MAX_HTML_BYTES, timeoutMs: this.#timeoutMs, userAgent: 'PlasticineLinkPreview/1.0' }, signal);
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(page.contentType)?.[1] ?? 'utf-8';
    let html: string;
    try { html = new TextDecoder(charset).decode(page.data); }
    catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      html = new TextDecoder().decode(page.data);
    }
    const preview = metadata(html, page.url);
    this.#cache.delete(key);
    this.#cache.set(key, { at: this.#now(), preview });
    if (this.#cache.size > CACHE_ENTRIES) this.#cache.delete(this.#cache.keys().next().value!);
    return preview;
  }
}
