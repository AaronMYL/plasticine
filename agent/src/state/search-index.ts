import type { Database, Row } from './db.ts';
import type { NoteBodies } from './note-bodies.ts';
import { SEARCH_SOURCES, materialRefs, type IndexRecord, type IndexSource, type SourceRef } from './search-sources.ts';
import { StateError } from './errors.ts';

export const BACKFILL_BATCH = 200;

const PURGE_SQL = "INSERT INTO search_fts (search_fts) VALUES ('optimize')";

const COLUMNS = ['source', 'ref', 'kind', 'object_kind', 'object_id', 'title', 'body', 'detail', 'tier', 'archived',
  'line_kind', 'line_id', 'updated_at'] as const;

function paramsOf(source: string, ref: string, record: IndexRecord): Record<string, string | number | null> {
  return {
    source,
    ref,
    kind: record.kind,
    object_kind: record.objectKind,
    object_id: record.objectId,
    title: record.title,
    body: record.body,
    detail: record.detail,
    tier: record.tier,
    archived: record.archived ? 1 : 0,
    line_kind: record.lineKind,
    line_id: record.lineId,
    updated_at: record.updatedAt,
  };
}

function unchanged(row: Row, params: Record<string, string | number | null>): boolean {
  return COLUMNS.every((column) => row[column] === params[column]);
}

export interface SearchIndex {
  changed(source: string, ref: string): void;
  materialChanged(kind: 'note' | 'memory_topic' | 'project' | 'space', id: string): void;
  purge(): void;
  backfill(): void;
  rebuild(sources?: readonly string[]): void;
  gaps(): Map<string, number>;
  sources: readonly IndexSource[];
}

export function createSearchIndex(db: Database, notes: NoteBodies,
  sources: readonly IndexSource[] = SEARCH_SOURCES): SearchIndex {
  const registry = new Map(sources.map((source) => [source.name, source]));
  const reader = { db, notes };

  function sourceOf(name: string): IndexSource {
    const source = registry.get(name);
    if (source === undefined) {
      throw new StateError('invalid_input', `索引里没有登记这类来源：${name}`);
    }
    return source;
  }

  function dropFts(row: Row): void {
    db.run(`INSERT INTO search_fts (search_fts, rowid, title, body, detail)
      VALUES ('delete', $id, $title, $body, $detail)`,
    { id: row['id'] ?? null, title: row['title'] ?? '', body: row['body'] ?? '', detail: row['detail'] ?? '' });
  }

  function write(source: string, ref: string, record: IndexRecord | null): void {
    const old = db.get('SELECT * FROM search_docs WHERE source = $source AND ref = $ref', { source, ref });
    if (record === null) {
      if (old !== undefined) {
        dropFts(old);
        db.run('DELETE FROM search_docs WHERE id = $id', { id: old['id'] ?? null });
      }
      return;
    }
    const params = paramsOf(source, ref, record);
    if (old !== undefined && unchanged(old, params)) {
      return;
    }
    let id: number;
    if (old === undefined) {
      const names = COLUMNS.join(', ');
      const values = COLUMNS.map((column) => `$${column}`).join(', ');
      id = Number(db.get(`INSERT INTO search_docs (${names}) VALUES (${values}) RETURNING id`, params)?.['id']);
    } else {
      dropFts(old);
      id = Number(old['id']);
      const sets = COLUMNS.map((column) => `${column} = $${column}`).join(', ');
      db.run(`UPDATE search_docs SET ${sets} WHERE id = $id`, { ...params, id });
    }
    db.run('INSERT INTO search_fts (rowid, title, body, detail) VALUES ($id, $title, $body, $detail)',
      { id, title: record.title, body: record.body, detail: record.detail });
  }

  function refresh(target: SourceRef, seen: Set<string>): void {
    const key = `${target.source}\u0000${target.ref}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const source = sourceOf(target.source);
    write(source.name, target.ref, source.load(reader, target.ref));
    db.run('DELETE FROM search_gaps WHERE source = $source AND ref = $ref', { source: target.source, ref: target.ref });
    for (const next of source.dependents?.(db, target.ref) ?? []) {
      refresh(next, seen);
    }
  }

  function changed(source: string, ref: string): void {
    db.transaction(() => refresh({ source, ref }, new Set()));
  }

  function fillOne(source: IndexSource, ref: string): void {
    try {
      db.transaction(() => refresh({ source: source.name, ref }, new Set()));
    } catch (error) {
      if (!(error instanceof StateError) || error.code !== 'corrupt_record') {
        throw error;
      }
      db.run(`INSERT INTO search_gaps (source, ref, reason, at) VALUES ($source, $ref, $reason, $at)
        ON CONFLICT (source, ref) DO UPDATE SET reason = excluded.reason, at = excluded.at`,
      { source: source.name, ref, reason: error.message, at: new Date().toISOString() });
    }
  }

  function fill(source: IndexSource): void {
    for (let after = 0; ;) {
      const batch = source.keys(db, after, BACKFILL_BATCH);
      if (batch.length === 0) {
        break;
      }
      db.transaction(() => {
        for (const entry of batch) {
          fillOne(source, entry.ref);
        }
      });
      after = batch.at(-1)?.rowid ?? after;
    }
    db.run(`INSERT INTO search_sources (source, version, filled_at) VALUES ($source, $version, $at)
      ON CONFLICT (source) DO UPDATE SET version = excluded.version, filled_at = excluded.filled_at`,
    { source: source.name, version: source.version, at: new Date().toISOString() });
  }

  function backfill(): void {
    const filled = new Map(db.all('SELECT source, version FROM search_sources')
      .map((row) => [String(row['source']), Number(row['version'])]));
    for (const source of sources) {
      if (filled.get(source.name) !== source.version) {
        fill(source);
      }
    }
  }

  function rebuild(names: readonly string[] = sources.map((source) => source.name)): void {
    for (const name of names) {
      const source = sourceOf(name);
      db.transaction(() => {
        for (const row of db.all('SELECT * FROM search_docs WHERE source = $source', { source: name })) {
          dropFts(row);
        }
        db.run('DELETE FROM search_docs WHERE source = $source', { source: name });
        db.run('DELETE FROM search_gaps WHERE source = $source', { source: name });
      });
      fill(source);
    }
  }

  function gaps(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of db.all('SELECT source, count(*) AS n FROM search_gaps GROUP BY source')) {
      const kind = registry.get(String(row['source']))?.kind ?? 'unknown';
      counts.set(kind, (counts.get(kind) ?? 0) + Number(row['n']));
    }
    return counts;
  }

  return {
    changed,
    materialChanged(kind, id) {
      db.transaction(() => {
        const seen = new Set<string>();
        for (const target of materialRefs(db, kind, id)) {
          refresh(target, seen);
        }
      });
    },
    purge() {
      db.run(PURGE_SQL);
    },
    backfill,
    rebuild,
    gaps,
    sources,
  };
}
