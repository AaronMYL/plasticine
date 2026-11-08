// 统一全文索引的来源登记（《优化清单》第 20 条）：每类来源说清三件事——回填时按什么顺序列出全部引用、一条引用现在
// 在索引里该是什么样（不该收就是 null）、改了它还要跟着重算哪些。写路径在各自 store 的同一个事务里调
// SearchIndex.changed(来源, 引用)，回填和增量用的是同一个 load，所以两边收进来的内容一样。
//
// 档位（第 113 条）：材料（笔记、记忆主题、项目）按 visibility_marks 里用户确认过的那一档；没标、只有建议的、
// 上了锁的笔记一律私密。其余几类（对话、书签、信息流、图书）还没有标档位的地方，都是私密。
// 归档：记忆里退休的行（改写、合并、不再成立）和退休的文档算归档；他说「忘掉」的行不收。

import { TIERS, type Tier } from '../../shared/api/visibility.ts';
import { spaceDocText } from '../../shared/space-text.ts';
import { INDEX_LINE_KINDS, type IndexKind, type IndexLineKind } from '../../shared/search-index.ts';
import type { Database, Row } from './db.ts';
import { StateError } from './errors.ts';
import { lineRef, plainText } from './lines.ts';
import type { NoteBodies } from './note-bodies.ts';

/** 索引里的一条。objectKind / objectId 是界面点开的那个对象（记忆的一行点开是它所在的文档）。 */
export interface IndexRecord {
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
}

export interface SourceReader {
  db: Database;
  notes: NoteBodies;
}

export interface SourceRef {
  source: string;
  ref: string;
}

export interface IndexSource {
  name: string;
  /** 收进索引的种类（缺口按种类报）。 */
  kind: IndexKind;
  /** 读法改了就加一，下次打开库重新回填这一类。 */
  version: number;
  /** 回填：rowid 在 after 之后的 limit 条引用，按 rowid 排。 */
  keys(db: Database, after: number, limit: number): { rowid: number; ref: string }[];
  load(reader: SourceReader, ref: string): IndexRecord | null;
  dependents?(db: Database, ref: string): SourceRef[];
}

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function optional(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

/** 各处的时间写法可能不一（旧导入的带时区），索引里统一成 ISO 的 UTC，比较和翻页才可靠。 */
function isoTime(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

function pagedKeys(table: string, refSql: string, where = '1 = 1') {
  return (db: Database, after: number, limit: number): { rowid: number; ref: string }[] =>
    db.all(`SELECT rowid AS rowid, ${refSql} AS ref FROM ${table} WHERE rowid > $after AND (${where})
      ORDER BY rowid LIMIT $limit`, { after, limit })
      .map((row) => ({ rowid: Number(row['rowid']), ref: text(row, 'ref') }));
}

type MaterialKind = 'note' | 'memory_topic' | 'project' | 'space';

/** 用户确认过的那一档；没有行、只有建议的都是私密。 */
export function materialTier(db: Database, kind: MaterialKind, id: string): Tier {
  const row = db.get('SELECT tier, confirmed_at FROM visibility_marks WHERE id = $id', { id: `${kind}:${id}` });
  const tier = TIERS.find((name) => name === row?.['tier']);
  return row === undefined || row['confirmed_at'] === null || tier === undefined ? 'private' : tier;
}

/** 某样材料的档位改了：索引里哪些要跟着重算。 */
export function materialRefs(db: Database, kind: MaterialKind, id: string): SourceRef[] {
  if (kind === 'note') {
    return [{ source: 'note', ref: id }];
  }
  if (kind === 'memory_topic') {
    return [{ source: 'memory_doc', ref: id }];
  }
  if (kind === 'space') {
    return [{ source: 'space', ref: id }];
  }
  return db.all('SELECT id FROM memory_docs WHERE project_id = $id', { id })
    .map((row) => ({ source: 'memory_doc', ref: text(row, 'id') }));
}

function byId(db: Database, table: string, id: string): Row | undefined {
  return db.get(`SELECT * FROM ${table} WHERE id = $id`, { id });
}

function base(kind: IndexKind, row: Row, objectKind: string) {
  return { kind, objectKind, objectId: text(row, 'id'), tier: 'private' as Tier, archived: false, lineKind: null,
    lineId: null, updatedAt: isoTime(text(row, 'updated_at')) };
}

const note: IndexSource = {
  name: 'note',
  kind: 'note',
  // 2：迁成空间的笔记（moved_to_space_id）不再收。
  version: 2,
  keys: pagedKeys('notes', 'id', 'deleted_at IS NULL AND moved_to_space_id IS NULL'),
  load({ db, notes }, ref) {
    const row = byId(db, 'notes', ref);
    if (row === undefined || row['deleted_at'] !== null || row['moved_to_space_id'] != null) {
      return null;
    }
    let body: string;
    try {
      body = notes.read(text(row, 'body_file'));
    } catch (cause) {
      throw new StateError('corrupt_record', '有笔记正文暂时无法读取。请重试，或先选择其他内容类型继续查找。', { cause });
    }
    const tier = row['private'] === 1 ? 'private' : materialTier(db, 'note', ref);
    return { ...base('note', row, 'note'), title: text(row, 'title'), body, detail: text(row, 'folder'), tier };
  },
};

const LINE_REF = /^line:(.+):(\d+)$/;

function originOf(meta: string | null): { kind: string | null; userText: string | null } {
  if (meta === null || meta === '') {
    return { kind: null, userText: null };
  }
  const parsed: unknown = JSON.parse(meta);
  const origin: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'origin') : null;
  if (typeof origin !== 'object' || origin === null) {
    return { kind: null, userText: null };
  }
  const kind: unknown = Reflect.get(origin, 'kind');
  const userText: unknown = Reflect.get(origin, 'userText');
  return { kind: typeof kind === 'string' ? kind : null, userText: typeof userText === 'string' ? userText : null };
}

function lineKindOf(kind: string): IndexLineKind {
  return INDEX_LINE_KINDS.find((name) => name === kind) ?? 'background';
}

// 所有线上他和 Plasticine 说的话。工具结果、委派给后台线的原文不收；他的话优先用 userText（不含服务端拼进去的
// 笔记、图书引用材料）。
const message: IndexSource = {
  name: 'message',
  kind: 'message',
  version: 1,
  keys: pagedKeys('line_messages', "'line:' || line_id || ':' || seq", "role IN ('user', 'assistant')"),
  load({ db }, ref) {
    const match = LINE_REF.exec(ref);
    if (match?.[1] === undefined || match[2] === undefined) {
      return null;
    }
    const row = db.get(`SELECT m.*, l.kind AS line_kind FROM line_messages m JOIN lines l ON l.id = m.line_id
      WHERE m.line_id = $line AND m.seq = $seq`, { line: match[1], seq: Number(match[2]) });
    const role = row?.['role'];
    if (row === undefined || (role !== 'user' && role !== 'assistant')) {
      return null;
    }
    let body: string;
    try {
      const origin = originOf(optional(row, 'meta'));
      if (origin.kind === 'delegation') {
        return null;
      }
      body = role === 'user' && origin.userText !== null ? origin.userText
        : plainText(JSON.parse(text(row, 'message')));
    } catch (cause) {
      throw new StateError('corrupt_record', '有对话暂时无法读取，请重试查找。', { cause });
    }
    if (body.trim() === '') {
      return null;
    }
    const lineId = text(row, 'line_id');
    return { kind: 'message', objectKind: 'message', objectId: lineRef(lineId, Number(row['seq'])),
      title: body.split('\n', 1)[0] ?? '', body, detail: role === 'user' ? '你' : 'Plasticine', tier: 'private',
      archived: false, lineKind: lineKindOf(text(row, 'line_kind')), lineId,
      updatedAt: isoTime(text(row, 'created_at')) };
  },
};

function docTier(db: Database, doc: Row): Tier {
  const projectId = optional(doc, 'project_id');
  return text(doc, 'kind') === 'project' && projectId !== null ? materialTier(db, 'project', projectId)
    : materialTier(db, 'memory_topic', text(doc, 'id'));
}

const memoryDoc: IndexSource = {
  name: 'memory_doc',
  kind: 'memory',
  version: 1,
  keys: pagedKeys('memory_docs', 'id'),
  load({ db }, ref) {
    const row = byId(db, 'memory_docs', ref);
    if (row === undefined) {
      return null;
    }
    return { ...base('memory', row, 'memory_doc'), title: text(row, 'title'), body: text(row, 'summary'),
      detail: '记忆', tier: docTier(db, row), archived: row['retired_at'] !== null };
  },
  dependents(db, ref) {
    return db.all('SELECT id FROM memory_doc_lines WHERE doc_id = $doc', { doc: ref })
      .map((row) => ({ source: 'memory_line', ref: text(row, 'id') }));
  },
};

/** 记忆的一行算不算归档。memory 线给行加上归档标记以后，改这里一处。 */
// 第 16 条三层（迁移 0070）：archived_at 有值算归档，deleted_at 有值不进索引；整篇退休照旧算归档。
export function memoryLineArchived(line: Row, doc: Row): boolean {
  return line['archived_at'] != null || doc['retired_at'] !== null;
}

function memoryLineGone(line: Row): boolean {
  return line['deleted_at'] != null || line['retired_reason'] === 'forgotten';
}

const memoryLine: IndexSource = {
  name: 'memory_line',
  kind: 'memory',
  version: 2,
  keys: pagedKeys('memory_doc_lines', 'id',
    "deleted_at IS NULL AND (retired_reason IS NULL OR retired_reason != 'forgotten')"),
  load({ db }, ref) {
    const row = byId(db, 'memory_doc_lines', ref);
    const doc = row === undefined ? undefined : byId(db, 'memory_docs', text(row, 'doc_id'));
    if (row === undefined || doc === undefined || memoryLineGone(row)) {
      return null;
    }
    return { ...base('memory', row, 'memory_doc'), objectId: text(doc, 'id'), title: text(doc, 'title'),
      body: text(row, 'text'), detail: '记忆', tier: docTier(db, doc), archived: memoryLineArchived(row, doc) };
  },
};

const agreement: IndexSource = {
  name: 'agreement',
  kind: 'memory',
  version: 1,
  keys: pagedKeys('agreements', 'id'),
  load({ db }, ref) {
    const row = byId(db, 'agreements', ref);
    if (row === undefined) {
      return null;
    }
    const body = ['text', 'scope', 'user_quote'].map((key) => text(row, key)).join('\n');
    return { ...base('memory', row, row['kind'] === 'term' ? 'term' : 'agreement'),
      title: text(row, 'title') || text(row, 'text'), body, detail: '' };
  },
};

// 第 2 版（第 8 条）：抓取时存下的中文标题、译文和摘要也收进来，搜中文能找到英文帖。
const feedItem: IndexSource = {
  name: 'feed_item',
  kind: 'feed',
  version: 2,
  keys: pagedKeys('feed_items', 'id', "reaction IS NULL OR reaction != 'dislike'"),
  load({ db }, ref) {
    const row = byId(db, 'feed_items', ref);
    if (row === undefined || row['reaction'] === 'dislike') {
      return null;
    }
    const zh = db.get('SELECT title, text, digest FROM feed_translations WHERE item_id = $id', { id: ref });
    const translated = zh === undefined ? [] : ['title', 'digest', 'text'].map((key) => text(zh, key))
      .filter((part) => part !== '');
    const body = [...['summary', 'why', 'note', 'topic'].map((key) => text(row, key)), ...translated].join('\n');
    return { ...base('feed', row, 'feed_item'), title: text(row, 'title'), body, detail: '' };
  },
};

const bookmark: IndexSource = {
  name: 'bookmark',
  kind: 'bookmark',
  version: 1,
  keys: pagedKeys('bookmarks', 'id', 'deleted_at IS NULL'),
  load({ db }, ref) {
    const row = byId(db, 'bookmarks', ref);
    if (row === undefined || row['deleted_at'] !== null) {
      return null;
    }
    // 网页的网址放在 detail，网址也查得到。
    return { ...base('bookmark', row, 'bookmark'), title: text(row, 'title'), body: text(row, 'snapshot'),
      detail: row['kind'] === 'web' ? text(row, 'target') : '' };
  },
};

const book: IndexSource = {
  name: 'book',
  kind: 'book',
  version: 1,
  keys: pagedKeys('books', 'id', 'deleted_at IS NULL'),
  load({ db }, ref) {
    const row = byId(db, 'books', ref);
    if (row === undefined || row['deleted_at'] !== null) {
      return null;
    }
    return { ...base('book', row, 'book'), title: text(row, 'title'), body: text(row, 'author'), detail: '' };
  },
  dependents(db, ref) {
    return db.all('SELECT id FROM book_annotations WHERE book_id = $book', { book: ref })
      .map((row) => ({ source: 'book_annotation', ref: text(row, 'id') }));
  },
};

// 批注：他写的字和划的那句原文；点开是那本书。
const bookAnnotation: IndexSource = {
  name: 'book_annotation',
  kind: 'book',
  version: 1,
  keys: pagedKeys('book_annotations', 'id', 'deleted_at IS NULL'),
  load({ db }, ref) {
    const row = byId(db, 'book_annotations', ref);
    const owner = row === undefined ? undefined : byId(db, 'books', text(row, 'book_id'));
    if (row === undefined || owner === undefined || row['deleted_at'] !== null || owner['deleted_at'] !== null) {
      return null;
    }
    const body = [text(row, 'note'), text(row, 'quote')].filter((part) => part !== '').join('\n');
    return { ...base('book', row, 'book'), objectId: text(owner, 'id'), title: text(owner, 'title'), body,
      detail: '' };
  },
};

// 空间（第 6 条）：档位照 visibility_marks，没标的私密；删掉的不收。
const space: IndexSource = {
  name: 'space',
  kind: 'space',
  version: 1,
  keys: pagedKeys('spaces', 'id', 'deleted_at IS NULL'),
  load({ db }, ref) {
    const row = byId(db, 'spaces', ref);
    if (row === undefined || row['deleted_at'] !== null) {
      return null;
    }
    let body: string;
    try {
      body = spaceDocText(JSON.parse(text(row, 'doc')));
    } catch (cause) {
      throw new StateError('corrupt_record', '有空间的正文暂时无法读取，请重试查找。', { cause });
    }
    return { ...base('space', row, 'space'), title: text(row, 'title'), body, detail: '空间',
      tier: materialTier(db, 'space', ref) };
  },
};

/** 来源登记。加一类就是在这里加一项，再在它的写路径里调 changed。 */
export const SEARCH_SOURCES: readonly IndexSource[] = [note, message, memoryDoc, memoryLine, agreement, feedItem,
  bookmark, book, bookAnnotation, space];
