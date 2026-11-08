// Reddit 版块的条目（第 7 批第 13 条）：抓取复用订阅的抓取器和 Atom 解析（feed-parse.ts 认 media:thumbnail、author），
// 这里只做 Reddit 自己的清洗——正文末尾那段「submitted by /u/x [link] [comments]」去掉，/u/x 存成作者；标题照原样，
// 链接用帖子页（Atom 的 entry/link 就是帖子页）。「本周最佳」的帖子会有一周前的，取的时间窗放宽到 8 天。

import type { ParsedFeedItem } from './feed-parse.ts';

/** 「本周最佳」要看到一周前发的帖子：多给一天余量。 */
export const REDDIT_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

// 正文里 Reddit 自己加的尾巴：作者链接、[link]（外链帖）、[comments]。
const SUBMITTED_TAIL = /\s*submitted by\s+\/?u\/[\w-]+(?:\s*\[link\])?(?:\s*\[comments\])?\s*$/i;
const AUTHOR = /^\/?u\/([\w-]+)$/i;

export interface RedditPost {
  title: string;
  url: string;
  /** 正文（外链帖、只有标题的帖子是空的）。 */
  text: string;
  /** 「u/名字」；删了号的是 null。 */
  author: string | null;
  image: string | null;
  publishedAt: string;
}

function authorOf(hit: ParsedFeedItem): string | null {
  const raw = hit.author?.trim() ?? '';
  const match = AUTHOR.exec(raw);
  if (match !== null) {
    return `u/${match[1]}`;
  }
  const tail = /submitted by\s+\/?u\/([\w-]+)/i.exec(hit.text);
  return tail === null ? null : `u/${tail[1]}`;
}

/** 一条 Reddit 帖子的样子：去掉尾巴、作者写成 u/名字；正文只剩尾巴的就是空。 */
export function redditPost(hit: ParsedFeedItem): RedditPost {
  return {
    title: hit.title,
    url: hit.url,
    text: hit.text.replace(SUBMITTED_TAIL, '').trim(),
    author: authorOf(hit),
    image: hit.image,
    publishedAt: hit.publishedAt,
  };
}
