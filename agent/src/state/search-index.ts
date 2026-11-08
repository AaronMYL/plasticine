// 统一全文索引的写入（《优化清单》第 20 条）：search_docs 一条记录一行，search_fts 是它的 FTS5 外部内容索引，两边由
// 这里一起改（外部内容表不会自己跟着变）。各 store 在自己的写事务里调 changed(来源, 引用)，这里按来源登记读出那一条
// 现在的样子写进索引，同一个事务提交或回滚。打开库时把还没回填（或读法升了版本）的来源分批回填，一批一个事务，
// 不把整张表读进内存。
//
// 索引是从原表算出来的：重建时清掉一类来源的索引行再回填，不碰原表里的任何数据。

import type { Database, Row } from './db.ts';
import type { NoteBodies } from './note-bodies.ts';
import { SEARCH_SOURCES, materialRefs, type IndexRecord, type IndexSource, type SourceRef } from './search-sources.ts';
import { StateError } from './errors.ts';

// 回填一批读多少条引用：几百条消息一两批就完；2 核 4G 的服务器上一批的事务也很短。
export const BACKFILL_BATCH = 200;

/** FTS5 的 optimize 命令。 */
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
  /** 一条来源记录改了（新建、改、删、档位变了）：在调用方的事务里把索引改成它现在的样子。 */
  changed(source: string, ref: string): void;
  /** 一样材料（笔记、记忆主题、项目）的档位改了。 */
  materialChanged(kind: 'note' | 'memory_topic' | 'project' | 'space', id: string): void;
  /** 删掉的条目在 FTS 旧分段里的词条真正清掉（合并全部分段）；只在「忘掉」这种真删之后调，平时不用。 */
  purge(): void;
  /** 回填还没回填过、或读法升了版本的来源。 */
  backfill(): void;
  /** 清掉这些来源（不给就是全部）的索引行，重新回填。 */
  rebuild(sources?: readonly string[]): void;
  /** 回填时读不出来的记录数，按索引种类。 */
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

  /** 回填里一条读不出来：记下缺口（查找时如实报），其余照常回填。 */
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
    // 回填时间用真实时钟：它只是索引自己的记录，不占用库里业务时间的读数。
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
        // 外部内容的 FTS 要拿旧内容删词条；然后再删索引行和缺口记录。
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
      // FTS5 删一条只是记一笔「删了」，原来的词条还在旧分段里，直到分段合并；optimize 把全部分段合成一个。
      db.run(PURGE_SQL);
    },
    backfill,
    rebuild,
    gaps,
    sources,
  };
}
