// 新内核的设置与模型凭证（迁移 0058）。
// - kernel_settings：一个键一行（设备 UUID、默认模型……），值是 JSON。
// - kernel_credentials：每个模型提供商一行，pi-ai 的凭证原样 JSON（api_key 或 oauth）。退出登录把凭证置空，不删行。
// 凭证只从这里进出：不进日志、不进接口响应（kernel/credentials.ts 只把「有没有、什么类型」给外面）。

import type { Row } from './db.ts';
import type { StoreContext } from './object-store.ts';

export interface StoredCredential {
  providerId: string;
  type: string;
  credential: unknown;
  updatedAt: string;
}

function credentialOf(row: Row): StoredCredential | undefined {
  const raw = row['credential'];
  const type = row['type'];
  if (raw === null || raw === undefined || type === null || type === undefined) {
    return undefined;
  }
  return {
    providerId: String(row['provider_id']),
    type: String(type),
    credential: JSON.parse(String(raw)) as unknown,
    updatedAt: String(row['updated_at']),
  };
}

export function createKernelSettingsStores(context: StoreContext) {
  const { db } = context;
  return {
    kernelSettings: {
      get(key: string): unknown {
        const row = db.get('SELECT value FROM kernel_settings WHERE key = $key', { key });
        return row === undefined ? undefined : JSON.parse(String(row['value'])) as unknown;
      },
      set(key: string, value: unknown): void {
        db.run(`INSERT INTO kernel_settings (key, value, updated_at) VALUES ($key, $value, $at)
          ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        { key, value: JSON.stringify(value), at: context.now() });
      },
    },
    kernelCredentials: {
      read(providerId: string): StoredCredential | undefined {
        const row = db.get('SELECT * FROM kernel_credentials WHERE provider_id = $providerId', { providerId });
        return row === undefined ? undefined : credentialOf(row);
      },
      list(): { providerId: string; type: string; updatedAt: string }[] {
        return db.all('SELECT provider_id, type, updated_at FROM kernel_credentials WHERE credential IS NOT NULL'
          + ' ORDER BY provider_id').map((row) => ({ providerId: String(row['provider_id']),
          type: String(row['type']), updatedAt: String(row['updated_at']) }));
      },
      write(providerId: string, type: string, credential: unknown): void {
        db.run(`INSERT INTO kernel_credentials (provider_id, type, credential, updated_at)
          VALUES ($providerId, $type, $credential, $at)
          ON CONFLICT (provider_id) DO UPDATE SET type = excluded.type, credential = excluded.credential,
            updated_at = excluded.updated_at`,
        { providerId, type, credential: JSON.stringify(credential), at: context.now() });
      },
      clear(providerId: string): void {
        db.run(`UPDATE kernel_credentials SET type = NULL, credential = NULL, updated_at = $at
          WHERE provider_id = $providerId`, { providerId, at: context.now() });
      },
    },
  };
}

export type KernelSettingsStores = ReturnType<typeof createKernelSettingsStores>;
