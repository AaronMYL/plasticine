// 信息流的几种来源各自交来的东西，换成一样的一条（订阅文章、Reddit 帖子、X 帖子、小红书笔记）；入库在
// feed-subscriptions.ts。第13批从那里拆出来（文件太长）。

import { createHash } from 'node:crypto';
import type { XPost } from '../../shared/api/feed-x.ts';
import type { XhsNote } from '../../shared/api/feed-xhs.ts';
import type { FeedBlock, FeedPlace } from '../../shared/state.ts';
import { articleBlocks } from './article-blocks.ts';
import type { parseFeed } from './feed-parse.ts';
import { safeUrl } from './link-data.ts';
import type { RedditPost } from './reddit.ts';

// 订阅文章的摘要：卡片上只放开头这些字，点开原文看全文。
const ARTICLE_SUMMARY_CHARS = 400;
// X 帖子没有标题：取正文第一行的前这些字当标题（读屏念、问 Plasticine 时引用）。
const POST_TITLE_CHARS = 60;

export interface NewEntry {
  key: string;
  title: string;
  url: string;
  summary: string;
  /** 订阅文章的全文（一段段）；没有就是 null。 */
  body?: FeedBlock[] | null;
  /** 在哪一处看到的（X、小红书）。 */
  places?: FeedPlace[];
  /** 拿来匹配关注点的文字。 */
  text: string;
  publishedAt: string | null;
  author: string | null;
  authorHandle: string | null;
  avatarUrl: string | null;
  imageUrl: string | null;
  imageRatio: number | null;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function httpsOrNull(raw: string | null | undefined): string | null {
  const url = safeUrl(raw);
  return url !== null && url.startsWith('https://') ? url : null;
}

export function postEntry(post: XPost): NewEntry {
  const firstLine = post.text.split('\n').find((line) => line.trim() !== '') ?? '';
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
    imageUrl: httpsOrNull(post.image),
    imageRatio: post.image === null ? null : post.imageRatio,
    places: post.places === undefined ? ['following'] : [...new Set(post.places)],
  };
}

/**
 * 最新的几条（新的在前）。perPlace：X 的三处各取最新的几条再合起来（第13批），书签里多是旧帖，不按发布时间和关注里的
 * 新帖一起挤，挤掉了就永远进不来。
 */
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

/** 小红书的一条笔记（第13批）：列表里只有标题，正文不重复标题。 */
export function noteEntry(note: XhsNote): NewEntry {
  const title = note.title.trim() === '' ? `${note.author}的笔记` : note.title.trim();
  return {
    key: `xhs:${note.id}`, title, url: `https://www.xiaohongshu.com/explore/${note.id}`, summary: title,
    text: title, publishedAt: null, author: note.author, authorHandle: null, avatarUrl: httpsOrNull(note.avatar),
    imageUrl: httpsOrNull(note.image), imageRatio: note.image === null ? null : note.imageRatio,
    places: [...new Set(note.places)],
  };
}

export function articleEntry(hit: ReturnType<typeof parseFeed>[number]): NewEntry {
  const body = articleBlocks(hit.html, hit.url);
  return {
    key: `rss:${createHash('sha256').update(hit.url).digest('hex')}`,
    title: hit.title, url: hit.url, summary: clip(hit.text, ARTICLE_SUMMARY_CHARS),
    body: body.length === 0 ? null : body,
    text: `${hit.title}\n${hit.text}`, publishedAt: hit.publishedAt, author: hit.author, authorHandle: null,
    avatarUrl: null, imageUrl: httpsOrNull(hit.image), imageRatio: null,
  };
}

export function redditEntry(post: RedditPost): NewEntry {
  return {
    key: `reddit:${createHash('sha256').update(post.url).digest('hex')}`,
    title: post.title, url: post.url, summary: clip(post.text, ARTICLE_SUMMARY_CHARS),
    text: `${post.title}\n${post.text}`, publishedAt: post.publishedAt, author: post.author, authorHandle: null,
    avatarUrl: null, imageUrl: httpsOrNull(post.image), imageRatio: null,
  };
}
