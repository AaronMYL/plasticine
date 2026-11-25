export const SEARCH_ENGINES = ['bing', 'google', 'baidu', 'duckduckgo'] as const;
export type SearchEngine = (typeof SEARCH_ENGINES)[number];

export const SEARCH_ENGINE_LABELS: Readonly<Record<SearchEngine, string>> = {
  bing: '必应', google: '谷歌', baidu: '百度', duckduckgo: 'DuckDuckGo',
};

const SEARCH_URLS: Readonly<Record<SearchEngine, string>> = {
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q=',
  baidu: 'https://www.baidu.com/s?wd=',
  duckduckgo: 'https://duckduckgo.com/?q=',
};

const KEY = 'plasticine.search-engine';
export const DEFAULT_SEARCH_ENGINE: SearchEngine = 'bing';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch (cause) {
    console.warn('读不到本机存储，搜索引擎用默认的', cause);
    return null;
  }
}

export function readSearchEngine(): SearchEngine {
  const value = storage()?.getItem(KEY) ?? null;
  return SEARCH_ENGINES.find((engine) => engine === value) ?? DEFAULT_SEARCH_ENGINE;
}

export function saveSearchEngine(engine: SearchEngine): void {
  storage()?.setItem(KEY, engine);
}

export function searchUrl(query: string, engine: SearchEngine = readSearchEngine()): string {
  return `${SEARCH_URLS[engine]}${encodeURIComponent(query.trim())}`;
}
