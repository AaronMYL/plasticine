// Shared by the read-only state query and its fake implementation. No recent-list limits: every eligible
// record is inspected; only the result page is limited. The cursor is tied to the query and an upper time bound.
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { SearchKindSchema, SearchQuerySchema, SearchTypeSchema,
  type SearchKind, type SearchQuery, type SearchResponse, type SearchResult, type SearchType } from './api/search.ts';

export const SEARCH_CATEGORY: Record<SearchKind, SearchType> = {
  note: 'notes', message: 'conversation', memory_doc: 'memory', agreement: 'memory', term: 'memory',
  feed_item: 'feed', bookmark: 'bookmarks', space: 'spaces', book: 'books',
};

export type SearchDocument = Omit<SearchResult, 'excerpt'> & { text: string };
type Position = Pick<SearchResult, 'kind' | 'id' | 'updatedAt'>;
const CursorSchema = Type.Object({
  v: Type.Literal(1), q: Type.String(), type: Type.Union([SearchTypeSchema, Type.Null()]), at: Type.String(),
  last: Type.Object({ kind: SearchKindSchema, id: Type.String(), updatedAt: Type.String() },
    { additionalProperties: false }),
}, { additionalProperties: false });

export class SearchQueryError extends Error {}

function positionOrder(a: Position, b: Position): number {
  const time = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (time !== 0) return time;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

/** 命中处前后一段（前 45 字、共约 180 字），压成一行；needle 已经是小写。 */
export function excerpt(text: string, needle: string): string {
  const compact = text.replace(/\s+/gu, ' ').trim();
  const index = compact.toLocaleLowerCase().indexOf(needle);
  const start = Math.max(0, index - 45);
  const end = Math.min(compact.length, Math.max(start + 180, index + needle.length));
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

export function searchDocuments(documents: Iterable<SearchDocument>, query: SearchQuery, now: string): SearchResponse {
  const started = performance.now();
  if (!Value.Check(SearchQuerySchema, query) || query.q.trim() === '') {
    throw new SearchQueryError('请填写 1–200 字的关键词，并选择有效的查找类型。');
  }
  const needle = query.q.trim().toLocaleLowerCase();
  let asOf = now;
  let after: Position | null = null;
  if (query.cursor !== undefined) {
    let value: unknown;
    try { value = JSON.parse(query.cursor); }
    catch (cause) { throw new SearchQueryError('翻页位置无效，请重新查找。', { cause }); }
    if (!Value.Check(CursorSchema, value) || value.q !== needle || value.type !== (query.type ?? null)
      || !Number.isFinite(Date.parse(value.at)) || !Number.isFinite(Date.parse(value.last.updatedAt))
      || Date.parse(value.at) > Date.parse(now)) {
      throw new SearchQueryError('翻页位置与这次查找不一致，请重新查找。');
    }
    asOf = value.at;
    after = value.last;
  }
  const matches: SearchResult[] = [];
  let total = 0;
  let scanned = 0;
  for (const document of documents) {
    if (query.type !== undefined && SEARCH_CATEGORY[document.kind] !== query.type) continue;
    if (Date.parse(document.updatedAt) > Date.parse(asOf)) continue;
    scanned += 1;
    const text = `${document.title}\n${document.text}\n${document.detail}`;
    if (!text.toLocaleLowerCase().includes(needle)) continue;
    total += 1;
    if (after !== null && positionOrder(document, after) <= 0) continue;
    const bodyMatches = document.text.toLocaleLowerCase().includes(needle);
    const titleMatches = document.title.toLocaleLowerCase().includes(needle);
    const nearby = bodyMatches || titleMatches ? document.text || document.title : document.detail;
    matches.push({ kind: document.kind, id: document.id, title: document.title.slice(0, 100),
      excerpt: excerpt(nearby, needle), updatedAt: document.updatedAt, detail: document.detail,
      ...(document.lineKind === undefined ? {} : { lineKind: document.lineKind }) });
  }
  matches.sort(positionOrder);
  const limit = query.limit ?? 20;
  const results = matches.slice(0, limit);
  const last = results.at(-1);
  return { results, total, asOf, scanned, elapsedMs: Math.round(performance.now() - started),
    nextCursor: matches.length > limit && last !== undefined
      ? JSON.stringify({ v: 1, q: needle, type: query.type ?? null, at: asOf,
        last: { kind: last.kind, id: last.id, updatedAt: last.updatedAt } }) : null };
}
