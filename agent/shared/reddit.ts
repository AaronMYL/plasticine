// Reddit 版块当信息流来源（第 7 批第 13 条，他定）：填版块名，服务器直接取版块的 Atom（11-08 在生产服务器实测
// /r/<版块>/.rss 是 200，JSON 接口 403），不用登录。排序三档：热门 / 最新 / 本周最佳，各是一个地址；来源行的 query
// 就存这个地址，排序从地址里读回来，不另存。两端共用：加来源对话框按它校验版块名、拼预览参数。

/** 版块名：Reddit 的规则是 3–21 个字母、数字、下划线（老版块有 2 个字的，放宽到 2）。 */
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

/** 他填的「r/neuroscience」「/r/neuroscience/」「neuroscience」或版块网址 → 版块名；认不出是 null。 */
export function subredditOf(raw: string): string | null {
  let text = raw.trim();
  const url = /^https?:\/\/(?:[a-z]+\.)?reddit\.com(\/[^?#]*)/i.exec(text);
  if (url !== null) {
    text = url[1] ?? '';
  }
  const name = text.replace(/^\/?r\//i, '').replace(/\/.*$/, '').trim();
  return SUBREDDIT.test(name) ? name : null;
}

/** 版块和排序 → 取的地址。 */
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

/** 来源行存的地址 → 版块和排序；不是 Reddit 版块的地址是 null。 */
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

/** 版块在界面上的名字。 */
export function redditLabel(subreddit: string): string {
  return `r/${subreddit}`;
}
