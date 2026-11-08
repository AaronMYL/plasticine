// 图书（用户 2026-11-01 定）：书、阅读进度（每本书一行，id 就是书的 id）、高亮与批注、大纲和重点。
// 原文件和转好的章节是 books/<id>/ 下的文件；删书、删标注都只打 deleted_at。

import type { Migration } from './migrate.ts';
import { inList, jsonColumn, OBJECT_COLUMNS } from './sql.ts';

const FORMATS = ['epub', 'txt', 'mobi', 'azw3'];
const COLORS = ['ochre', 'sage', 'slate', 'rose'];
const ORIGINS = ['user', 'plasticine'];
const INSIGHT_KINDS = ['outline', 'key_points'];
const INSIGHT_STATUSES = ['generating', 'ready', 'failed'];

export const migration: Migration = {
  id: '0037-books',
  up(db) {
    db.exec(`CREATE TABLE books (${OBJECT_COLUMNS},
      title TEXT NOT NULL,
      author TEXT,
      language TEXT,
      format TEXT NOT NULL CHECK (format IN ${inList(FORMATS)}),
      file_name TEXT NOT NULL,
      source_bytes INTEGER NOT NULL CHECK (source_bytes > 0),
      source_sha256 TEXT NOT NULL,
      cover_asset TEXT,
      ${jsonColumn('toc', false)},
      char_count INTEGER NOT NULL CHECK (char_count >= 0),
      last_opened_at TEXT,
      deleted_at TEXT
    )`);
    db.exec('CREATE INDEX books_source ON books (source_sha256)');
    db.exec(`CREATE TABLE book_progress (${OBJECT_COLUMNS},
      book_id TEXT NOT NULL REFERENCES books(id),
      chapter INTEGER NOT NULL CHECK (chapter >= 0),
      offset INTEGER NOT NULL CHECK (offset >= 0),
      percent REAL NOT NULL CHECK (percent >= 0 AND percent <= 1),
      device_label TEXT NOT NULL
    )`);
    db.exec(`CREATE TABLE book_annotations (${OBJECT_COLUMNS},
      book_id TEXT NOT NULL REFERENCES books(id),
      chapter INTEGER NOT NULL CHECK (chapter >= 0),
      start INTEGER NOT NULL CHECK (start >= 0),
      end INTEGER NOT NULL CHECK (end > start),
      quote TEXT NOT NULL,
      prefix TEXT NOT NULL,
      suffix TEXT NOT NULL,
      color TEXT NOT NULL CHECK (color IN ${inList(COLORS)}),
      note TEXT,
      origin TEXT NOT NULL CHECK (origin IN ${inList(ORIGINS)}),
      device_label TEXT,
      deleted_at TEXT
    )`);
    db.exec('CREATE INDEX book_annotations_book ON book_annotations (book_id, chapter, start)');
    db.exec(`CREATE TABLE book_insights (${OBJECT_COLUMNS},
      book_id TEXT NOT NULL REFERENCES books(id),
      kind TEXT NOT NULL CHECK (kind IN ${inList(INSIGHT_KINDS)}),
      status TEXT NOT NULL CHECK (status IN ${inList(INSIGHT_STATUSES)}),
      source_sha256 TEXT NOT NULL,
      ${jsonColumn('content', true)},
      error TEXT,
      generated_at TEXT,
      ${jsonColumn('dismissed_point_ids', false)},
      UNIQUE (book_id, kind)
    )`);
  },
};
