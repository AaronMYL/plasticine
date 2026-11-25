import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { TAVILY_FREE_MONTHLY, type WebSearchProvider, type WebSearchStatus } from '../../shared/api/index.ts';

export const WEB_SEARCH_SETTING = 'web_search';
const USAGE_SETTING = 'web_search_usage';
const SEARCH_URL = 'https://api.tavily.com/search';
const EXTRACT_URL = 'https://api.tavily.com/extract';
const KEY_HINT_MIN = 12;
const KEY_HINT_CHARS = 4;
export const WEB_SEARCH_MAX_RESULTS = 10;
export const WEB_FETCH_MAX_CHARS = 60_000;

const StoredSchema = Type.Object({
  provider: Type.Literal('tavily'),
  apiKey: Type.String({ minLength: 1 }),
  testedAt: Type.Union([Type.String(), Type.Null()]),
  testOk: Type.Union([Type.Boolean(), Type.Null()]),
});
type Stored = { provider: WebSearchProvider; apiKey: string; testedAt: string | null; testOk: boolean | null };

const UsageSchema = Type.Object({ month: Type.String(), count: Type.Integer({ minimum: 0 }) });

export interface SettingsPort {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface WebSearchDeps {
  settings: SettingsPort;
  fetch: typeof fetch;
  now: () => Date;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

export interface WebSearchOptions {
  maxResults: number;
  topic: 'general' | 'news';
  timeRange: 'day' | 'week' | 'month' | 'year' | null;
}

export class WebSearchError extends Error {
  readonly code: 'not_configured' | 'unauthorized' | 'quota' | 'failed';
  constructor(code: WebSearchError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

function hint(key: string): string | null {
  return key.length < KEY_HINT_MIN ? null : `…${key.slice(-KEY_HINT_CHARS)}`;
}

function errorFor(status: number, detail: string): WebSearchError {
  if (status === 401 || status === 403) return new WebSearchError('unauthorized', '搜索服务说密钥不对：去设置里换一个。');
  if (status === 432 || status === 433) return new WebSearchError('quota', '搜索服务这个月的额度用完了。');
  if (status === 429) return new WebSearchError('failed', '搜索服务说太快了，过一会儿再搜。');
  return new WebSearchError('failed', `搜索服务没答上（${status}）：${detail.slice(0, 120)}`);
}

export class WebSearch {
  readonly #deps: WebSearchDeps;

  constructor(deps: WebSearchDeps) {
    this.#deps = deps;
  }

  #stored(): Stored | null {
    const value = this.#deps.settings.get(WEB_SEARCH_SETTING);
    return Value.Check(StoredSchema, value) ? value : null;
  }

  #month(): string {
    return this.#deps.now().toISOString().slice(0, 7);
  }

  #used(): number {
    const usage = this.#deps.settings.get(USAGE_SETTING);
    return Value.Check(UsageSchema, usage) && usage.month === this.#month() ? usage.count : 0;
  }

  #count(): void {
    this.#deps.settings.set(USAGE_SETTING, { month: this.#month(), count: this.#used() + 1 });
  }

  status(): WebSearchStatus {
    const stored = this.#stored();
    return { provider: 'tavily', configured: stored !== null, keyHint: stored === null ? null : hint(stored.apiKey),
      usedThisMonth: this.#used(), monthlyFree: TAVILY_FREE_MONTHLY, testedAt: stored?.testedAt ?? null,
      testOk: stored?.testOk ?? null };
  }

  save(apiKey: string | null): WebSearchStatus {
    this.#deps.settings.set(WEB_SEARCH_SETTING, apiKey === null ? null
      : { provider: 'tavily', apiKey: apiKey.trim(), testedAt: null, testOk: null });
    return this.status();
  }

  async test(signal: AbortSignal): Promise<{ ok: boolean; error: string | null }> {
    const stored = this.#stored();
    if (stored === null) return { ok: false, error: '还没填密钥。' };
    let error: string | null = null;
    try {
      await this.search('Plasticine', { maxResults: 1, topic: 'general', timeRange: null }, signal);
    } catch (cause) {
      if (!(cause instanceof WebSearchError)) throw cause;
      error = cause.message;
    }
    this.#deps.settings.set(WEB_SEARCH_SETTING, { ...stored, testedAt: this.#deps.now().toISOString(),
      testOk: error === null });
    return { ok: error === null, error };
  }

  async #post(url: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const stored = this.#stored();
    if (stored === null) {
      throw new WebSearchError('not_configured', '还没接搜索服务：请他在设置 · 网络搜索里填 Tavily 的密钥。');
    }
    let response: Response;
    try {
      response = await this.#deps.fetch(url, { method: 'POST', signal, body: JSON.stringify(body),
        headers: { authorization: `Bearer ${stored.apiKey}`, 'content-type': 'application/json' } });
    } catch (cause) {
      if (signal.aborted) throw cause;
      throw new WebSearchError('failed', `连不上搜索服务：${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const text = await response.text();
    if (!response.ok) throw errorFor(response.status, text);
    this.#count();
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      if (cause instanceof SyntaxError) throw new WebSearchError('failed', '搜索服务回的不是 JSON。');
      throw cause;
    }
  }

  async search(query: string, options: WebSearchOptions, signal: AbortSignal): Promise<WebSearchResult[]> {
    const body = await this.#post(SEARCH_URL, { query, search_depth: 'basic', topic: options.topic,
      max_results: Math.min(options.maxResults, WEB_SEARCH_MAX_RESULTS), include_published_date: true,
      ...(options.timeRange === null ? {} : { time_range: options.timeRange }) }, signal);
    const results: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'results') : null;
    if (!Array.isArray(results)) return [];
    return results.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return [];
      const field = (key: string): string | null => {
        const value: unknown = Reflect.get(item, key);
        return typeof value === 'string' && value !== '' ? value : null;
      };
      const url = field('url');
      return url === null ? [] : [{ title: field('title') ?? url, url, snippet: field('content') ?? '',
        publishedAt: field('published_date') }];
    });
  }

  async extract(url: string, signal: AbortSignal): Promise<{ url: string; content: string; truncated: boolean }> {
    const body = await this.#post(EXTRACT_URL, { urls: [url], extract_depth: 'basic', format: 'markdown' }, signal);
    const list = (key: string): unknown[] => {
      const value: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, key) : null;
      return Array.isArray(value) ? value : [];
    };
    const first: unknown = list('results')[0];
    const raw: unknown = typeof first === 'object' && first !== null ? Reflect.get(first, 'raw_content') : null;
    if (typeof raw !== 'string') {
      const failed: unknown = list('failed_results')[0];
      const why: unknown = typeof failed === 'object' && failed !== null ? Reflect.get(failed, 'error') : null;
      throw new WebSearchError('failed', `这一页没抓到正文${typeof why === 'string' ? `：${why}` : ''}。`
        + '要登录或靠脚本画出来的页面，用云端浏览器或 Mac 上的网页标签打开再读。');
    }
    const truncated = raw.length > WEB_FETCH_MAX_CHARS;
    return { url, content: truncated ? raw.slice(0, WEB_FETCH_MAX_CHARS) : raw, truncated };
  }
}
