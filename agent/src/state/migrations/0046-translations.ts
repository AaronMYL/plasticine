import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

const TARGETS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es'];
const DISPLAYS = ['bilingual', 'translation'];

export const migration: Migration = {
  id: '0046-translations',
  up(db) {
    db.exec(`CREATE TABLE translate_settings (${RECORD_COLUMNS},
      target TEXT NOT NULL CHECK (target IN ${inList(TARGETS)}),
      display TEXT NOT NULL CHECK (display IN ${inList(DISPLAYS)}),
      ${booleanColumn('glossary', 1)},
      ${jsonColumn('always_sites', false)}
    )`);
    db.exec(`CREATE TABLE translation_cache (
      source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
      target TEXT NOT NULL,
      model TEXT NOT NULL,
      glossary_hash TEXT NOT NULL,
      text TEXT NOT NULL,
      source_chars INTEGER NOT NULL CHECK (source_chars >= 0),
      created_at TEXT NOT NULL,
      used_at TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
      PRIMARY KEY (source_hash, target, model, glossary_hash)
    ) WITHOUT ROWID`);
    db.exec('CREATE INDEX translation_cache_used ON translation_cache(used_at)');
  },
};
