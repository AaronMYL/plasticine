import { TIERS, type Tier } from '../../shared/api/visibility.ts';
import { spaceHtmlText } from '../../shared/space-html.ts';
import { spaceDocText } from '../../shared/space-text.ts';
import { INDEX_LINE_KINDS, type IndexKind, type IndexLineKind } from '../../shared/search-index.ts';
import type { Database, Row } from './db.ts';
import { StateError } from './errors.ts';
import { lineRef, plainText } from './lines.ts';
import type { NoteBodies } from './note-bodies.ts';

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
  kind: IndexKind;
  version: number;
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

export function materialTier(db: Database, kind: MaterialKind, id: string): Tier {
  const row = db.get('SELECT tier, confirmed_at FROM visibility_marks WHERE id = $id', { id: `${kind}:${id}` });
  const tier = TIERS.find((name) => name === row?.['tier']);
  return row === undefined || row['confirmed_at'] === null || tier === undefined ? 'private' : tier;
}

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
    const tier = materialTier(db, 'note', ref);
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

const space: IndexSource = {
  name: 'space',
  kind: 'space',
  version: 2,
  keys: pagedKeys('spaces', 'id', 'deleted_at IS NULL'),
  load({ db }, ref) {
    const row = byId(db, 'spaces', ref);
    if (row === undefined || row['deleted_at'] !== null) {
      return null;
    }
    let body: string;
    try {
      const html = row['html'];
      body = typeof html === 'string' ? spaceHtmlText(html) : spaceDocText(JSON.parse(text(row, 'doc')));
    } catch (cause) {
      throw new StateError('corrupt_record', '有空间的正文暂时无法读取，请重试查找。', { cause });
    }
    return { ...base('space', row, 'space'), title: text(row, 'title'), body, detail: '空间',
      tier: materialTier(db, 'space', ref) };
  },
};

export const SEARCH_SOURCES: readonly IndexSource[] = [note, message, memoryDoc, memoryLine, feedItem, bookmark, book,
  bookAnnotation, space];
