import type { ParsedFeedItem } from './feed-parse.ts';

export const REDDIT_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

const SUBMITTED_TAIL = /\s*submitted by\s+\/?u\/[\w-]+(?:\s*\[link\])?(?:\s*\[comments\])?\s*$/i;
const AUTHOR = /^\/?u\/([\w-]+)$/i;

export interface RedditPost {
  title: string;
  url: string;
  text: string;
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
