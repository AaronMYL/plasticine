// 2026-11-03 沉浸式翻译（第 2 批）：翻译设置一行（没有行时全是默认值，所以不写默认行），和译文缓存。只加表，不改旧表。
// 缓存只存原文的散列和译文（不存原文），按（原文散列、目标语言、模型、这段用到的词表散列）分；used_at / hits 给以后
// 清理旧缓存和量命中率用。

import type { Migration } from './migrate.ts';
import { booleanColumn, inList, jsonColumn, RECORD_COLUMNS } from './sql.ts';

// 写在迁移里的常量：以后加语言是新迁移，不改这里（sql.ts 开头的说明）。
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
