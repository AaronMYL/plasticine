import { BOOKMARK_TITLE_MAX, type BookmarkKind } from './state-bookmarks.ts';

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
    return `web:${target}`;
  }
}

export function bookmarkHost(target: string | null): string | null {
  if (target === null || !/^https?:\/\//i.test(target)) {
    return null;
  }
  try {
    return new URL(target).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export interface SuggestionCandidate {
  id: string;
  kind: BookmarkKind;
  target: string | null;
  title: string;
  projectId: string | null;
  snapshot: string | null;
}

export interface SuggestionProject {
  id: string;
  name: string;
}

export const SUGGESTION_SNAPSHOT_CHARS = 2_000;
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

export interface ParsedBookmark {
  title: string;
  url: string;
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

const TOKEN = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl>/gi;

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
