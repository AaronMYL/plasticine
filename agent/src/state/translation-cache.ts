// 译文缓存（2026-11-03 沉浸式翻译，迁移 0046）：按（原文散列、目标语言、模型、这段用到的词表散列）存一份译文，同一页
// 再开不再花额度。只存散列不存原文。命中时记 used_at 和 hits（以后清理旧缓存、量命中率用）；重译直接覆盖。

import { TranslationEntrySchema, TranslationKeySchema, type TranslationEntry, type TranslationKey }
  from '../../shared/state.ts';
import { checked } from './codec.ts';
import type { StoreContext } from './object-store.ts';

const LOOKUP_SQL = `SELECT text FROM translation_cache WHERE source_hash = $source_hash AND target = $target
  AND model = $model AND glossary_hash = $glossary_hash`;
const TOUCH_SQL = `UPDATE translation_cache SET used_at = $used_at, hits = hits + 1 WHERE source_hash = $source_hash
  AND target = $target AND model = $model AND glossary_hash = $glossary_hash`;
const STORE_SQL = `INSERT INTO translation_cache (source_hash, target, model, glossary_hash, text, source_chars,
  created_at, used_at, hits) VALUES ($source_hash, $target, $model, $glossary_hash, $text, $source_chars, $now, $now, 0)
  ON CONFLICT (source_hash, target, model, glossary_hash) DO UPDATE SET text = excluded.text,
  source_chars = excluded.source_chars, created_at = excluded.created_at, used_at = excluded.used_at`;

function keyParams(key: TranslationKey): Record<string, string> {
  return { source_hash: key.sourceHash, target: key.target, model: key.model, glossary_hash: key.glossaryHash };
}

export function createTranslationCache(context: StoreContext) {
  /** 一个键在 Map 里的写法（lookup 的结果按它取）。 */
  const keyOf = (key: TranslationKey): string => [key.sourceHash, key.target, key.model, key.glossaryHash]
    .join('\u0000');
  return {
    keyOf,
    /** 这些键里存过的译文，按 keyOf 取；命中的记一次用过。 */
    lookup(keys: readonly TranslationKey[]): Map<string, string> {
      const found = new Map<string, string>();
      if (keys.length === 0) {
        return found;
      }
      context.db.transaction(() => {
        const usedAt = context.now();
        for (const key of keys) {
          const params = keyParams(checked(TranslationKeySchema, key, 'invalid_input', '译文缓存的键'));
          const row = context.db.get(LOOKUP_SQL, params);
          if (row !== undefined && typeof row['text'] === 'string' && !found.has(keyOf(key))) {
            found.set(keyOf(key), row['text']);
            context.db.run(TOUCH_SQL, { ...params, used_at: usedAt });
          }
        }
      });
      return found;
    },
    store(entries: readonly TranslationEntry[]): void {
      if (entries.length === 0) {
        return;
      }
      context.db.transaction(() => {
        const now = context.now();
        for (const entry of entries) {
          const valid = checked(TranslationEntrySchema, entry, 'invalid_input', '译文缓存');
          context.db.run(STORE_SQL, { ...keyParams(valid), text: valid.text, source_chars: valid.sourceChars, now });
        }
      });
    },
    /** 存了多少段、一共命中过多少次（度量和测试看）。 */
    stats(): { entries: number; hits: number } {
      const row = context.db.get('SELECT count(*) AS entries, coalesce(sum(hits), 0) AS hits FROM translation_cache');
      return { entries: Number(row?.['entries'] ?? 0), hits: Number(row?.['hits'] ?? 0) };
    },
  };
}

export type TranslationCache = ReturnType<typeof createTranslationCache>;
