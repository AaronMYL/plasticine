import { createHash } from 'node:crypto';
import type { XPost } from '../../shared/api/feed-x.ts';
import type { XhsNote } from '../../shared/api/feed-xhs.ts';
import { FEED_MORE_IMAGES_MAX, type FeedBlock, type FeedImage, type FeedPlace } from '../../shared/state.ts';
import { articleBlocks } from './article-blocks.ts';
import type { parseFeed } from './feed-parse.ts';
import { safeUrl } from './link-data.ts';
import type { RedditPost } from './reddit.ts';
import { linkKey } from './urls.ts';

const ARTICLE_SUMMARY_CHARS = 400;
const POST_TITLE_CHARS = 60;

export interface NewEntry {
  key: string;
  title: string;
  url: string;
  summary: string;
  body?: FeedBlock[] | null;
  places?: FeedPlace[];
  text: string;
  publishedAt: string | null;
  author: string | null;
  authorHandle: string | null;
  avatarUrl: string | null;
  imageUrl: string | null;
  imageRatio: number | null;
  moreImages?: FeedImage[];
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function httpsOrNull(raw: string | null | undefined): string | null {
  const url = safeUrl(raw);
  return url !== null && url.startsWith('https://') ? url : null;
}

function postImages(post: XPost): FeedImage[] {
  const given = post.images ?? (post.image === null ? [] : [{ url: post.image, ratio: post.imageRatio }]);
  const seen = new Set<string>();
  return given.flatMap((image) => {
    const url = httpsOrNull(image.url);
    if (url === null || seen.has(url)) return [];
    seen.add(url);
    return [{ url, ratio: image.ratio }];
  });
}

export function postEntry(post: XPost): NewEntry {
  const firstLine = post.text.split('\n').find((line) => line.trim() !== '') ?? '';
  const [cover, ...rest] = postImages(post);
  return {
    key: `x:${post.id}`,
    title: firstLine === '' ? `@${post.handle}` : clip(firstLine, POST_TITLE_CHARS),
    url: `https://x.com/${post.handle}/status/${post.id}`,
    summary: post.text.trim(),
    text: post.text,
    publishedAt: post.publishedAt,
    author: post.author,
    authorHandle: post.handle,
    avatarUrl: httpsOrNull(post.avatar),
    imageUrl: cover?.url ?? null,
    imageRatio: cover?.ratio ?? null,
    moreImages: rest.slice(0, FEED_MORE_IMAGES_MAX),
    places: post.places === undefined ? ['following'] : [...new Set(post.places)],
  };
}

export function newest(entries: readonly NewEntry[], cap: number, perPlace: boolean): NewEntry[] {
  const byTime = [...entries].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  if (!perPlace) { return byTime.slice(0, cap); }
  const picked = new Set<NewEntry>();
  for (const place of new Set(byTime.flatMap((entry) => entry.places ?? []))) {
    const here = byTime.filter((entry) => entry.places?.includes(place) === true);
    here.slice(0, cap).forEach((entry) => picked.add(entry));
  }
  return byTime.filter((entry) => picked.has(entry));
}

export function noteLink(note: Pick<XhsNote, 'id' | 'xsecToken'>): string {
  const page = `https://www.xiaohongshu.com/explore/${note.id}`;
  return note.xsecToken === undefined ? page
    : `${page}?xsec_token=${encodeURIComponent(note.xsecToken)}&xsec_source=pc_feed`;
}

export function noteEntry(note: XhsNote): NewEntry {
  const title = note.title.trim() === '' ? `${note.author}的笔记` : note.title.trim();
  return {
    key: `xhs:${note.id}`, title, url: noteLink(note), summary: title,
    text: title, publishedAt: null, author: note.author, authorHandle: null, avatarUrl: httpsOrNull(note.avatar),
    imageUrl: httpsOrNull(note.image), imageRatio: note.image === null ? null : note.imageRatio,
    places: [...new Set(note.places)],
  };
}

function linkHash(url: string): string {
  return createHash('sha256').update(linkKey(url)).digest('hex');
}

export function articleEntry(hit: ReturnType<typeof parseFeed>[number]): NewEntry {
  const body = articleBlocks(hit.html, hit.url);
  return {
    key: `rss:${linkHash(hit.url)}`,
    title: hit.title, url: hit.url, summary: clip(hit.text, ARTICLE_SUMMARY_CHARS),
    body: body.length === 0 ? null : body,
    text: `${hit.title}\n${hit.text}`, publishedAt: hit.publishedAt, author: hit.author, authorHandle: null,
    avatarUrl: null, imageUrl: httpsOrNull(hit.image), imageRatio: null,
  };
}

export function redditEntry(post: RedditPost): NewEntry {
  return {
    key: `reddit:${linkHash(post.url)}`,
    title: post.title, url: post.url, summary: clip(post.text, ARTICLE_SUMMARY_CHARS),
    text: `${post.title}\n${post.text}`, publishedAt: post.publishedAt, author: post.author, authorHandle: null,
    avatarUrl: null, imageUrl: httpsOrNull(post.image), imageRatio: null,
  };
}
