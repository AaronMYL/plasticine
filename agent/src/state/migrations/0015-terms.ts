import type { Migration } from './migrate.ts';

// 只识别旧词表已知的三档。时间和当时版本无法证明的解码明确留空，原记录仍保留。
const LEGACY_DATA = `CASE WHEN json_valid(json_extract(legacy_payload, '$.row.data'))
  THEN json_extract(legacy_payload, '$.row.data') ELSE '{}' END`;

export const migration: Migration = {
  id: '0015-terms',
  up(db) {
    db.exec('ALTER TABLE agreements ADD COLUMN term_tier TEXT');
    db.exec(`ALTER TABLE agreements ADD COLUMN proposed_term TEXT
      CHECK (proposed_term IS NULL OR json_valid(proposed_term))`);
    db.exec(`CREATE TABLE term_decodings (
      id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES agreements(id), term_version INTEGER,
      anchor TEXT CHECK (anchor IS NULL OR json_valid(anchor)),
      text TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT
    )`);
    db.exec('CREATE INDEX term_decodings_term ON term_decodings(term_id, created_at)');
    db.exec(`UPDATE agreements SET term_tier = CASE json_extract(${LEGACY_DATA}, '$.tier')
      WHEN 'exact' THEN 'exact' WHEN '精确' THEN 'exact'
      WHEN 'analogy' THEN 'metaphor' WHEN 'metaphor' THEN 'metaphor' WHEN '比喻' THEN 'metaphor'
      WHEN 'outside' THEN 'borrowed' WHEN 'borrowed' THEN 'borrowed' WHEN '借词' THEN 'borrowed'
      ELSE NULL END WHERE kind = 'term'`);
    db.exec(`INSERT INTO term_decodings (id, term_id, term_version, anchor, text, author, created_at)
      WITH old AS (SELECT id, ${LEGACY_DATA} AS data FROM agreements WHERE kind = 'term'),
      decoded AS (SELECT old.id AS term_id, item.key AS position,
        CASE WHEN item.type = 'text' THEN item.value
          WHEN item.type = 'object' THEN coalesce(json_extract(item.value, '$.text'),
            json_extract(item.value, '$.decoded')) ELSE NULL END AS text
        FROM old, json_each(old.data, '$.decodings') AS item)
      SELECT 'legacy:' || term_id || ':' || position, term_id, NULL, NULL, text, 'migration', NULL
      FROM decoded WHERE typeof(text) = 'text' AND length(text) BETWEEN 1 AND 20000`);
  },
};
