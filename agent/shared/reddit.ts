export const SUBREDDIT_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_]{1,20}$';
const SUBREDDIT = new RegExp(SUBREDDIT_PATTERN);

export const REDDIT_SORTS = ['hot', 'new', 'top_week'] as const;
export type RedditSort = (typeof REDDIT_SORTS)[number];
export const REDDIT_SORT_LABELS: Readonly<Record<RedditSort, string>> = {
  hot: '热门',
  new: '最新',
  top_week: '本周最佳',
};

const REDDIT_ORIGIN = 'https://www.reddit.com';

export function subredditOf(raw: string): string | null {
  let text = raw.trim();
  const url = /^https?:\/\/(?:[a-z]+\.)?reddit\.com(\/[^?#]*)/i.exec(text);
  if (url !== null) {
    text = url[1] ?? '';
  }
  const name = text.replace(/^\/?r\//i, '').replace(/\/.*$/, '').trim();
  return SUBREDDIT.test(name) ? name : null;
}

export function redditFeedUrl(subreddit: string, sort: RedditSort): string {
  const base = `${REDDIT_ORIGIN}/r/${subreddit}`;
  if (sort === 'new') {
    return `${base}/new/.rss`;
  }
  if (sort === 'top_week') {
    return `${base}/top/.rss?t=week`;
  }
  return `${base}/.rss`;
}

export function redditFeedOf(url: string): { subreddit: string; sort: RedditSort } | null {
  const match = /^https:\/\/www\.reddit\.com\/r\/([A-Za-z0-9_]+)\/(new\/|top\/)?\.rss(\?t=week)?$/.exec(url);
  if (match === null || !SUBREDDIT.test(match[1] ?? '')) {
    return null;
  }
  const paths: Readonly<Record<string, RedditSort>> = { 'new/': 'new', 'top/': 'top_week' };
  const sort = paths[match[2] ?? ''] ?? 'hot';
  if ((sort === 'top_week') !== (match[3] !== undefined)) {
    return null;
  }
  return { subreddit: match[1] ?? '', sort };
}

export function redditLabel(subreddit: string): string {
  return `r/${subreddit}`;
}
