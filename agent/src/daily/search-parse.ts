import { shownError } from './errors.ts';
import { child, content, elements, local, plain, xml } from './feed-parse.ts';
import { checkUrl, siteOf } from './urls.ts';

const RESULTS_PER_TERM = 15;
const TITLE_CHARS = 300;
const TEXT_CHARS = 800;
export interface SearchHit {
  title: string;
  url: string;
  text: string;
  publishedAt: string | null;
  site: string;
  undated: boolean;
}

function unwrapLink(raw: string): string | null {
  try {
    const outer = new URL(raw.trim());
    const inner = outer.searchParams.get('url');
    const bing = /(^|\.)bing\.com$/i.test(outer.hostname);
    return checkUrl(bing && inner ? new URL(inner).href : outer.href);
  } catch {
    return null;
  }
}

function parse(source: string, undated: boolean): SearchHit[] {
  const root = xml(source);
  const channel = child(root, 'channel');
  if (local(root) !== 'rss' || channel === undefined) {
    throw shownError('invalid_input', '搜索入口没有返回 RSS，请稍后刷新。');
  }
  const items = elements(channel).filter((entry) => local(entry) === 'item').slice(0, RESULTS_PER_TERM);
  return items.flatMap((entry) => {
    const url = unwrapLink(content(child(entry, 'link')));
    const title = plain(content(child(entry, 'title'))).slice(0, TITLE_CHARS);
    if (url === null || title === '') { return []; }
    const date = Date.parse(plain(content(child(entry, 'pubdate'))));
    const publishedAt = !undated && Number.isFinite(date) ? new Date(date).toISOString() : null;
    const site = plain(content(child(entry, 'source'))) || siteOf(url);
    return [{ title, url, text: plain(content(child(entry, 'description'))).slice(0, TEXT_CHARS),
      publishedAt, site, undated: undated || publishedAt === null }];
  });
}

export function parseNewsRss(source: string): SearchHit[] { return parse(source, false); }
export function parseSearchRss(source: string): SearchHit[] { return parse(source, true); }
