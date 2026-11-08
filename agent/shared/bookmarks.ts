// 书签两端共用的规则（第 110 条）：同一个网址 / 地址算不算同一条、Plasticine 给没归项目的书签推哪个项目（✦）、
// 浏览器导出的书签 HTML（Netscape 格式，Chrome 和 Safari 都是它）怎么读、原来的文件夹对到哪个项目。
// 都是纯函数：服务端和假接口用同一份，推法和读法不会两边各一套。

import type { BookmarkKind } from './state-bookmarks.ts';
import { BOOKMARK_TITLE_MAX } from './state-bookmarks.ts';

/** 同一个东西的键：网页按规整过的网址（主机名小写、去掉末尾的 #），页面按 #/… 地址原样。 */
export function bookmarkKey(kind: BookmarkKind, target: string | null): string | null {
  if (target === null || kind === 'group') {
    return null;
  }
  if (kind === 'page') {
    return `page:${target}`;
  }
  try {
    const url = new URL(target);
    const href = url.href.endsWith('#') ? url.href.slice(0, -1) : url.href;
    return `web:${href}`;
  } catch {
    // 解析不了就按原文比较。不记日志：网址里可能带口令，服务端也用这一份。
    return `web:${target}`;
  }
}

/** 网页的主机名（去掉 www.）；不是网页或解析不了是 null。 */
export function bookmarkHost(target: string | null): string | null {
  if (target === null || !/^https?:\/\//i.test(target)) {
    return null;
  }
  try {
    return new URL(target).host.replace(/^www\./, '');
  } catch {
    // 解析不了就不算主机名（同上，不记日志）。
    return null;
  }
}

export interface SuggestionCandidate {
  id: string;
  kind: BookmarkKind;
  target: string | null;
  title: string;
  projectId: string | null;
  /** 正文快照的开头一段（推法只看这么多）。 */
  snapshot: string | null;
}

export interface SuggestionProject {
  id: string;
  name: string;
}

/** 推法只看正文开头这么多字：够认出讲的是哪个项目，又不让一篇长文里偶尔提一句就算数。 */
export const SUGGESTION_SNAPSHOT_CHARS = 2_000;
/** 项目名短于这么多字不拿来在正文里找（「个人」这种词到处都是）。 */
const NAME_MATCH_MIN_CHARS = 3;

function sameHostProject(bookmark: SuggestionCandidate, others: readonly SuggestionCandidate[]): string | null {
  const host = bookmarkHost(bookmark.target);
  if (host === null) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const other of others) {
    if (other.id !== bookmark.id && other.projectId !== null && bookmarkHost(other.target) === host) {
      counts.set(other.projectId, (counts.get(other.projectId) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (first === undefined || (second !== undefined && second[1] === first[1])) {
    return null;
  }
  return first[0];
}

function namedProject(bookmark: SuggestionCandidate, projects: readonly SuggestionProject[]): string | null {
  const text = `${bookmark.title}\n${(bookmark.snapshot ?? '').slice(0, SUGGESTION_SNAPSHOT_CHARS)}`
    .toLocaleLowerCase();
  const named = projects.filter((project) => Array.from(project.name).length >= NAME_MATCH_MIN_CHARS
    && text.includes(project.name.toLocaleLowerCase()));
  return named.length === 1 ? named[0]!.id : null;
}

/**
 * 没归项目的书签推一个项目：先看同一个网站的书签多半归在哪（并列就不推），再看名字或正文开头提到了哪个项目
 * （只提到一个才推）。拿不准就是 null，等用户自己点。
 */
export function suggestProject(bookmark: SuggestionCandidate, others: readonly SuggestionCandidate[],
  projects: readonly SuggestionProject[]): string | null {
  if (bookmark.projectId !== null) {
    return null;
  }
  const known = new Set(projects.map((project) => project.id));
  const byHost = sameHostProject(bookmark, others);
  if (byHost !== null && known.has(byHost)) {
    return byHost;
  }
  return namedProject(bookmark, projects);
}

// ---------- 导入浏览器导出的书签 HTML ----------

export interface ParsedBookmark {
  title: string;
  url: string;
  /** 从外到里的文件夹名；不在文件夹里是 []。 */
  folders: string[];
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function hrefOf(attributes: string): string | null {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  return raw === undefined ? null : decodeEntities(raw).trim();
}

// 一个文件夹是 <DT><H3>名字</H3> 后面跟一个 <DL>…</DL>；一条书签是 <DT><A HREF="…">名字</A>。
const TOKEN = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl>/gi;

/** 读 Chrome / Safari 导出的书签 HTML：只要 http(s) 链接，带上它在哪几层文件夹里。读不出东西是 []。 */
export function parseBookmarkHtml(html: string): ParsedBookmark[] {
  const items: ParsedBookmark[] = [];
  const stack: (string | null)[] = [];
  let pendingFolder: string | null = null;
  for (const match of html.matchAll(TOKEN)) {
    const token = match[0].toLowerCase();
    if (match[1] !== undefined) {
      pendingFolder = plainText(match[1]);
    } else if (match[2] !== undefined) {
      const url = hrefOf(match[2]);
      if (url !== null && /^https?:\/\//i.test(url)) {
        const title = plainText(match[3] ?? '') || url;
        items.push({ title: Array.from(title).slice(0, BOOKMARK_TITLE_MAX).join(''), url,
          folders: stack.filter((folder): folder is string => folder !== null && folder !== '') });
      }
    } else if (token.startsWith('</dl')) {
      stack.pop();
    } else {
      stack.push(pendingFolder);
      pendingFolder = null;
    }
  }
  return items;
}

/** 原来的文件夹对到哪个项目：从最里面一层往外找，名字和项目名一样（不分大小写）的就是。对不上是 null。 */
export function folderProject(folders: readonly string[], projects: readonly SuggestionProject[]): string | null {
  for (const folder of [...folders].reverse()) {
    const name = folder.trim().toLocaleLowerCase();
    const found = projects.find((project) => project.name.trim().toLocaleLowerCase() === name);
    if (found !== undefined) {
      return found.id;
    }
  }
  return null;
}
