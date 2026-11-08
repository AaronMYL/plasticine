// 网站图标的缓存（迁移 0110）：一个域名一行，取到的是图标字节，取不到记 none。什么时候过期、怎么取由
// app/favicons.ts 和 cloud-tools/favicon-fetch.ts 定，这里只存取。

import type { StoreContext } from './object-store.ts';

export type CachedFavicon =
  | { status: 'ok'; mime: string; data: Uint8Array; fetchedAt: string; expiresAt: string }
  | { status: 'none'; fetchedAt: string; expiresAt: string };

export function createFaviconStore(context: StoreContext) {
  const { db } = context;
  return {
    get: (host: string): CachedFavicon | null => {
      const row = db.get('SELECT * FROM web_favicons WHERE host = $host', { host });
      if (row === undefined) {
        return null;
      }
      const fetchedAt = String(row['fetched_at']);
      const expiresAt = String(row['expires_at']);
      const data = row['data'];
      if (row['status'] === 'ok' && data instanceof Uint8Array && typeof row['mime'] === 'string') {
        return { status: 'ok', mime: row['mime'], data, fetchedAt, expiresAt };
      }
      return { status: 'none', fetchedAt, expiresAt };
    },
    put: (host: string, entry: CachedFavicon): void => {
      const ok = entry.status === 'ok';
      db.run(`INSERT INTO web_favicons (host, status, mime, data, fetched_at, expires_at)
        VALUES ($host, $status, $mime, $data, $fetchedAt, $expiresAt)
        ON CONFLICT (host) DO UPDATE SET status = excluded.status, mime = excluded.mime, data = excluded.data,
          fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
      { host, status: entry.status, mime: ok ? entry.mime : null, data: ok ? entry.data : null,
        fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt });
    },
  };
}

export type FaviconStore = ReturnType<typeof createFaviconStore>;
