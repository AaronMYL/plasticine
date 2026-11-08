// 统一全文索引（2026-11-07《优化清单》第 20 条）：search_docs 一条记录一行（能点回原对象的引用、档位、归档、线的
// 种类），search_fts 是它的 FTS5 外部内容索引，trigram 分词（中文按三个字一组切，少于三个字的查找退到 LIKE）。
// 回填不在这里做：笔记正文在库外的文件里，迁移读不到；打开库时来源登记按 search_sources 一类一类分批回填
// （state/search-index.ts），一次只读一批。

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

// 每类来源回填到哪一版；来源的读法改了就升版本号，下次打开库重新回填那一类。
const SOURCES = `CREATE TABLE search_sources (
  source TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL,
  filled_at TEXT NOT NULL
)`;

// 回填时读不出来的记录（笔记正文文件缺了之类）：查找到这一类时如实报「有内容读不了」，不把缺的当成没有。
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
