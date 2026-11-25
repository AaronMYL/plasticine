import { FEED_URL_MAX_CHARS } from '../../shared/state.ts';
import { cleanUrlQuery, isCredentialParam } from '../util/index.ts';
import { shownError } from './errors.ts';

export { cleanUrlQuery, isCredentialParam };

function parsed(raw: string, field: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw shownError('invalid_input', '链接不是完整的网址；请用 https:// 或 http:// 开头的地址。', field);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw shownError('invalid_input', '链接只收 http / https 地址。', field);
  }
  return url;
}

function bounded(link: string, field: string): string {
  if (link.length > FEED_URL_MAX_CHARS) {
    throw shownError('invalid_input', `链接超过 ${FEED_URL_MAX_CHARS} 个字符。`, field);
  }
  return link;
}

export function checkUrl(raw: string, field = 'url'): string {
  return bounded(parsed(raw, field).href, field);
}

export function linkKey(raw: string, field = 'url'): string {
  const url = parsed(raw, field);
  url.username = '';
  url.password = '';
  const query = url.search.slice(1);
  const cleanedQuery = cleanUrlQuery(query);
  if (cleanedQuery !== query) {
    url.search = cleanedQuery;
  }
  url.hash = '';
  return bounded(url.toString(), field);
}

export function siteOf(url: string): string {
  return new URL(checkUrl(url)).host;
}
