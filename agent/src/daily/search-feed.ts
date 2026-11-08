// 10-29：按旧版 newsSearch 请求 Bing RSS，不增加第二次模型调用或新依赖。
import type { FeedFetcher } from './feed-fetch.ts';
import { parseNewsRss, parseSearchRss, type SearchHit } from './search-parse.ts';

export async function searchNews(term: string, fetcher: FeedFetcher, signal: AbortSignal): Promise<SearchHit[]> {
  const chinese = /[\u4e00-\u9fff]/.test(term);
  const news = new URL('https://www.bing.com/news/search');
  news.searchParams.set('q', term);
  news.searchParams.set('format', 'rss');
  news.searchParams.set('qft', 'interval="7"');
  news.searchParams.set('setlang', chinese ? 'zh-hans' : 'en-us');
  if (!chinese) { news.searchParams.set('cc', 'US'); }
  try {
    const page = await fetcher.get(news.href, signal);
    const hits = parseNewsRss(page.text);
    if (hits.length > 0) { return hits; }
  } catch {
    // 新闻失败走旧版的网页后备；取消则立刻退出，不再发下一次请求。
    signal.throwIfAborted();
  }
  const web = new URL('https://www.bing.com/search');
  web.searchParams.set('format', 'rss');
  web.searchParams.set('q', term);
  const page = await fetcher.get(web.href, signal);
  return parseSearchRss(page.text);
}
