// 做事经验的「对应哪些网站或应用」和用量（迁移 0148，内核优化第二批）：只读写 memory_docs 的这三列，不碰文档的内容和
// 版本（用量不是内容，带出一次不该让这一篇在界面上算「改过」）。

import type { StoreContext } from './object-store.ts';

/** 一篇最多记这么多个网站或应用。 */
export const MAX_DOC_SITES = 8;

export interface DocUsage {
  sites: string[];
  useCount: number;
  lastUsedAt: string | null;
}

/** 网站写成小写的主机名（去掉 www.）；应用名原样去空白。 */
export function siteKey(text: string): string {
  const trimmed = text.trim();
  const host = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
  return host === null ? trimmed : host.replace(/^www\./, '');
}

function parseSites(raw: unknown): string[] {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function createMemoryDocUsageStore(context: StoreContext) {
  const { db } = context;
  return {
    get(docId: string): DocUsage | undefined {
      const row = db.get('SELECT sites, use_count, last_used_at FROM memory_docs WHERE id = $id', { id: docId });
      if (row === undefined) {
        return undefined;
      }
      const last = row['last_used_at'];
      return { sites: parseSites(row['sites']), useCount: Number(row['use_count']),
        lastUsedAt: last === null || last === undefined ? null : String(last) };
    },
    /** 加上几个网站或应用（去重，最多 MAX_DOC_SITES 个，先来的留着）。 */
    addSites(docId: string, sites: readonly string[]): void {
      const current = this.get(docId)?.sites ?? [];
      const merged = [...new Set([...current, ...sites.map(siteKey).filter((site) => site !== '')])]
        .slice(0, MAX_DOC_SITES);
      if (merged.length !== current.length) {
        db.run('UPDATE memory_docs SET sites = $sites WHERE id = $id', { id: docId, sites: JSON.stringify(merged) });
      }
    },
    /** 在用的、记了这些网站或应用之一的文档的标识。 */
    docsFor(kind: string, keys: readonly string[]): string[] {
      if (keys.length === 0) {
        return [];
      }
      return db.all(`SELECT id FROM memory_docs WHERE kind = $kind AND retired_at IS NULL
        AND EXISTS (SELECT 1 FROM json_each(memory_docs.sites) WHERE value IN (SELECT value FROM json_each($keys)))
        ORDER BY created_at, id`, { kind, keys: JSON.stringify(keys) }).map((row) => String(row['id']));
    },
    used(docId: string): void {
      db.run('UPDATE memory_docs SET use_count = use_count + 1, last_used_at = $at WHERE id = $id',
        { id: docId, at: context.now() });
    },
  };
}
