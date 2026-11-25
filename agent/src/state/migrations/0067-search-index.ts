import type { Migration } from './migrate.ts';

const DOCS = `CREATE TABLE search_docs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  detail TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'private',
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  line_kind TEXT,
  line_id TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (source, ref)
)`;

const FTS = `CREATE VIRTUAL TABLE search_fts USING fts5(title, body, detail,
  content = 'search_docs', content_rowid = 'id', tokenize = 'trigram')`;

const SOURCES = `CREATE TABLE search_sources (
  source TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  filled_at TEXT NOT NULL
)`;

const GAPS = `CREATE TABLE search_gaps (
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (source, ref)
)`;

export const migration: Migration = {
  id: '0067-search-index',
  up(db) {
    db.exec(DOCS);
    db.exec('CREATE INDEX search_docs_kind ON search_docs (kind, updated_at)');
    db.exec('CREATE INDEX search_docs_object ON search_docs (object_kind, object_id)');
    db.exec(FTS);
    db.exec(SOURCES);
    db.exec(GAPS);
  },
};
