// 查找（2026-11-07《优化清单》第 20 条起走统一全文索引）：⌘K、「翻对话」、记忆的默认搜索都查 search_docs /
// search_fts，不再每次全表扫描。三个字以上用 FTS5 trigram 的 MATCH，按 bm25 排、再加一点新近度；一两个字 trigram
// 不命中，退到对索引表的 LIKE（标题命中的在前，再按新近）。
// 界面接口（/v2/search）的入参和返回形状不变，多了两个可选参数：最高档位、含归档。不给 = 本人界面：全部档位、
// 不含归档的记忆。图书、空间在索引里，但界面接口还没有这两类结果，先只给模型的工具用。

import { Value } from 'typebox/value';
import { Type } from 'typebox';
import { SearchKindSchema, SearchQuerySchema, SearchTypeSchema, type SearchKind, type SearchQuery,
  type SearchResponse, type SearchResult, type SearchType } from '../../shared/api/index.ts';
import { TIERS, type Tier } from '../../shared/api/visibility.ts';
import { excerpt, SearchQueryError } from '../../shared/search.ts';
import { tiersUpTo, type IndexKind, type IndexLineKind } from '../../shared/search-index.ts';
import type { Database, Params, Row } from './db.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';
import type { SearchIndex } from './search-index.ts';

// 新近度只加一点：刚说过的最多多三成分，一个月减半。相关度相近时新的在前，不让新近压过相关。
const RECENCY_BOOST = 0.3;
const RECENCY_HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// bm25 的列权重：标题、正文、补充（文件夹、网址）。
const BM25_WEIGHTS = '4.0, 1.0, 0.5';
// trigram 至少要三个字才有词条。
const TRIGRAM_CHARS = 3;
const DEFAULT_LIMIT = 20;

/** 界面接口的类型 → 索引种类。 */
const TYPE_KINDS: Readonly<Record<SearchType, IndexKind>> = {
  notes: 'note', conversation: 'message', memory: 'memory', feed: 'feed', bookmarks: 'bookmark', spaces: 'space',
  books: 'book',
};
const API_KINDS = new Set<string>(SearchKindSchema.enum);

export interface IndexQuery {
  q: string;
  kinds?: readonly IndexKind[];
  lineKinds?: readonly IndexLineKind[];
  /** 时间下界（含），ISO。 */
  from?: string;
  /** 时间上界（不含），ISO。 */
  before?: string;
  maxTier?: Tier;
  includeArchived?: boolean;
  /** 只看这一刻以前的（翻页时固定住，后来的等刷新）。 */
  asOf: string;
}

export interface IndexHit {
  source: string;
  ref: string;
  kind: IndexKind;
  objectKind: string;
  objectId: string;
  title: string;
  body: string;
  detail: string;
  tier: Tier;
  archived: boolean;
  lineKind: IndexLineKind | null;
  lineId: string | null;
  updatedAt: string;
  score: number;
}

const CursorSchema = Type.Object({
  v: Type.Literal(2),
  q: Type.String(),
  type: Type.Union([SearchTypeSchema, Type.Null()]),
  maxTier: Type.Union([Type.Enum(TIERS), Type.Null()]),
  archived: Type.Boolean(),
  at: Type.String(),
  last: Type.Object({ score: Type.Number(), updatedAt: Type.String(), kind: SearchKindSchema, id: Type.String() },
    { additionalProperties: false }),
}, { additionalProperties: false });

interface Position {
  score: number;
  updatedAt: string;
  kind: string;
  id: string;
}

/** 分高的在前；同分新的在前；再按种类和编号，保证翻页稳定。 */
function positionOrder(a: Position, b: Position): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function filters(query: IndexQuery, params: Params): string[] {
  const clauses = ['d.updated_at <= $as_of'];
  params['as_of'] = query.asOf;
  const list = (name: string, column: string, values: readonly string[]): void => {
    const names = values.map((value, index) => {
      params[`${name}${index}`] = value;
      return `$${name}${index}`;
    });
    clauses.push(names.length === 0 ? '0' : `d.${column} IN (${names.join(', ')})`);
  };
  if (query.kinds !== undefined) list('kind', 'kind', query.kinds);
  if (query.lineKinds !== undefined) list('line_kind', 'line_kind', query.lineKinds);
  if (query.maxTier !== undefined) list('tier', 'tier', tiersUpTo(query.maxTier));
  if (query.includeArchived !== true) clauses.push('d.archived = 0');
  if (query.from !== undefined) {
    clauses.push('d.updated_at >= $from');
    params['from'] = query.from;
  }
  if (query.before !== undefined) {
    clauses.push('d.updated_at < $before');
    params['before'] = query.before;
  }
  return clauses;
}

function hitOf(row: Row, relevance: number, asOf: number): IndexHit {
  const updatedAt = String(row['updated_at']);
  const ageDays = Math.max(0, (asOf - Date.parse(updatedAt)) / DAY_MS);
  const recency = Number.isFinite(ageDays) ? 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS) : 0;
  const nullable = (key: string): string | null => (typeof row[key] === 'string' ? row[key] : null);
  return {
    source: String(row['source']),
    ref: String(row['ref']),
    kind: String(row['kind']) as IndexKind,
    objectKind: String(row['object_kind']),
    objectId: String(row['object_id']),
    title: String(row['title']),
    body: String(row['body']),
    detail: String(row['detail']),
    tier: String(row['tier']) as Tier,
    archived: row['archived'] === 1,
    lineKind: nullable('line_kind') as IndexLineKind | null,
    lineId: nullable('line_id'),
    updatedAt,
    score: relevance * (1 + RECENCY_BOOST * recency),
  };
}

function hitOrder(a: IndexHit, b: IndexHit): number {
  return positionOrder({ score: a.score, updatedAt: a.updatedAt, kind: a.objectKind, id: a.objectId },
    { score: b.score, updatedAt: b.updatedAt, kind: b.objectKind, id: b.objectId }) || (a.ref < b.ref ? -1 : 1);
}

/** 全部命中（每条索引记录一条），按分排好。 */
export function indexMatches(db: Database, query: IndexQuery): IndexHit[] {
  const q = query.q.trim();
  const params: Params = {};
  const where = filters(query, params);
  const asOf = Date.parse(query.asOf);
  let hits: IndexHit[];
  if (Array.from(q).length >= TRIGRAM_CHARS) {
    params['match'] = `"${q.replace(/"/g, '""')}"`;
    const rows = db.all(`SELECT d.*, bm25(search_fts, ${BM25_WEIGHTS}) AS rank FROM search_fts
      JOIN search_docs d ON d.id = search_fts.rowid WHERE search_fts MATCH $match AND ${where.join(' AND ')}`, params);
    hits = rows.map((row) => hitOf(row, -Number(row['rank']), asOf));
  } else {
    params['pattern'] = likePattern(q);
    const rows = db.all(`SELECT d.* FROM search_docs d WHERE (d.title LIKE $pattern ESCAPE '\\'
      OR d.body LIKE $pattern ESCAPE '\\' OR d.detail LIKE $pattern ESCAPE '\\') AND ${where.join(' AND ')}`, params);
    const needle = q.toLocaleLowerCase();
    hits = rows.map((row) => hitOf(row, String(row['title']).toLocaleLowerCase().includes(needle) ? 2 : 1, asOf));
  }
  return hits.sort(hitOrder);
}

function scannedCount(db: Database, query: IndexQuery): number {
  const params: Params = {};
  const where = filters(query, params);
  return Number(db.get(`SELECT count(*) AS n FROM search_docs d WHERE ${where.join(' AND ')}`, params)?.['n'] ?? 0);
}

const GAP_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  note: '有笔记正文暂时无法读取。请重试，或先选择其他内容类型继续查找。',
  message: '有对话暂时无法读取，请重试查找。',
};

/** 要查的种类里有回填时没读出来的记录：如实失败，不把缺了的当成没有。 */
function requireComplete(index: SearchIndex, kinds: readonly IndexKind[]): void {
  const gaps = index.gaps();
  for (const kind of kinds) {
    if ((gaps.get(kind) ?? 0) > 0) {
      throw new StateError('corrupt_record', GAP_MESSAGES[kind] ?? '有保存的内容暂时无法读取，查找未完成。');
    }
  }
}

interface CursorState {
  asOf: string;
  after: Position | null;
}

function readCursor(query: SearchQuery, needle: string, now: string): CursorState {
  if (query.cursor === undefined) {
    return { asOf: now, after: null };
  }
  let value: unknown;
  try { value = JSON.parse(query.cursor); }
  catch (cause) { throw new SearchQueryError('翻页位置无效，请重新查找。', { cause }); }
  if (!Value.Check(CursorSchema, value) || value.q !== needle || value.type !== (query.type ?? null)
    || value.maxTier !== (query.maxTier ?? null) || value.archived !== (query.includeArchived ?? false)
    || !Number.isFinite(Date.parse(value.at)) || Date.parse(value.at) > Date.parse(now)) {
    throw new SearchQueryError('翻页位置与这次查找不一致，请重新查找。');
  }
  return { asOf: value.at, after: value.last };
}

function resultOf(hit: IndexHit, needle: string): SearchResult {
  const bodyMatches = hit.body.toLocaleLowerCase().includes(needle);
  const titleMatches = hit.title.toLocaleLowerCase().includes(needle);
  const nearby = bodyMatches || titleMatches ? hit.body || hit.title : hit.detail;
  return { kind: hit.objectKind as SearchKind, id: hit.objectId, title: hit.title.slice(0, 100),
    excerpt: excerpt(nearby, needle), updatedAt: hit.updatedAt, detail: hit.detail,
    ...(hit.objectKind === 'message' && hit.lineKind !== null ? { lineKind: hit.lineKind } : {}) };
}

export function createSearchStore(context: StoreContext, index: SearchIndex) {
  function query(input: SearchQuery): SearchResponse {
    const started = performance.now();
    if (!Value.Check(SearchQuerySchema, input) || input.q.trim() === '') {
      throw new SearchQueryError('请填写 1–200 字的关键词，并选择有效的查找类型。');
    }
    const needle = input.q.trim().toLocaleLowerCase();
    const { asOf, after } = readCursor(input, needle, context.now());
    const kinds = input.type === undefined ? Object.values(TYPE_KINDS) : [TYPE_KINDS[input.type]];
    requireComplete(index, kinds);
    const scope: IndexQuery = { q: input.q, kinds, asOf, includeArchived: input.includeArchived ?? false,
      ...(input.maxTier === undefined ? {} : { maxTier: input.maxTier }) };
    // 同一个对象（一份记忆文档的几行）只出一条：取分最高的那条记录。
    const best = new Map<string, IndexHit>();
    for (const hit of indexMatches(context.db, scope)) {
      const key = `${hit.objectKind}\u0000${hit.objectId}`;
      if (API_KINDS.has(hit.objectKind) && !best.has(key)) best.set(key, hit);
    }
    const ordered = [...best.values()];
    const position = (hit: IndexHit): Position =>
      ({ score: hit.score, updatedAt: hit.updatedAt, kind: hit.objectKind, id: hit.objectId });
    const remaining = after === null ? ordered : ordered.filter((hit) => positionOrder(position(hit), after) > 0);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const page = remaining.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = remaining.length > limit && last !== undefined
      ? JSON.stringify({ v: 2, q: needle, type: input.type ?? null, maxTier: input.maxTier ?? null,
        archived: input.includeArchived ?? false, at: asOf, last: position(last) }) : null;
    return { results: page.map((hit) => resultOf(hit, needle)), total: ordered.length, nextCursor, asOf,
      scanned: scannedCount(context.db, scope), elapsedMs: Math.round(performance.now() - started) };
  }

  return {
    query,
    /** 给模型的工具和别的模块：按种类、线、时间、档位查，返回每条索引记录（不合并），分高的在前。 */
    find(scope: Omit<IndexQuery, 'asOf'>): IndexHit[] {
      if (scope.q.trim() === '') {
        throw new SearchQueryError('请填写要找的词。');
      }
      requireComplete(index, scope.kinds ?? []);
      return indexMatches(context.db, { ...scope, asOf: context.now() });
    },
    /** 记忆写路径用（memory 线）：这一行 / 这份文档改了，在调用方的事务里重算它在索引里的样子。 */
    reindexMemoryLine: (lineId: string): void => index.changed('memory_line', lineId),
    reindexMemoryDoc: (docId: string): void => index.changed('memory_doc', docId),
    /** 维护用：清掉这些来源的索引重新回填（不给就是全部）。不动原表。 */
    rebuild: (sources?: readonly string[]): void => index.rebuild(sources),
  };
}

export type SearchStore = ReturnType<typeof createSearchStore>;
