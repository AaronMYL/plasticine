import type { Migration } from './migrate.ts';

const TABLES = ['term_decodings', 'agreements', 'device_keys'] as const;
const SEARCH_TABLES = ['search_docs', 'search_sources', 'search_gaps', 'search_fts', 'search_fts_data',
  'search_fts_idx', 'search_fts_docsize'] as const;

export const migration: Migration = {
  id: '0141-drop-agreements',
  destructive: true,
  changes: [...TABLES, ...SEARCH_TABLES],
  up(db) {
    db.exec(`INSERT INTO search_fts (search_fts, rowid, title, body, detail)
      SELECT 'delete', id, title, body, detail FROM search_docs WHERE source = 'agreement'`);
    db.exec("DELETE FROM search_docs WHERE source = 'agreement'");
    db.exec("DELETE FROM search_sources WHERE source = 'agreement'");
    db.exec("DELETE FROM search_gaps WHERE source = 'agreement'");
    for (const table of TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};
