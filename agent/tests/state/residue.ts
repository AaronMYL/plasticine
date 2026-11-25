import type { Database } from '../../src/state/db.ts';

export function tablesHolding(db: Database, needle: string): string[] {
  const bytes = Buffer.from(needle, 'utf8');
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((row) => String(row['name']));
  return tables.filter((table) => db.all(`SELECT * FROM "${table}"`).some((row) =>
    Object.values(row).some((value) => (typeof value === 'string' && value.includes(needle))
      || (value instanceof Uint8Array && Buffer.from(value).includes(bytes)))));
}

export function ftsHits(db: Database, needle: string): number {
  const phrase = `"${needle.replaceAll('"', '""')}"`;
  return Number(db.get('SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH $q', { q: phrase })?.['n']);
}
