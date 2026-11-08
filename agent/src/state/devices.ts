// 登记过的设备（第 90 条 ②）：配对时登记名字和首次时间，之后每次带会话的请求更新最后时间；撤销只打时间，不删行。
// 第 118 条：有效的本人配对会话即可确认操作，旧设备公钥不再作为确认前提。

import {
  DeviceInputSchema,
  DevicePatchSchema,
  DeviceSchema,
  type Device,
  type DeviceInput,
  type Page,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  name: 'text',
  firstSeenAt: 'text',
  lastSeenAt: 'text',
  revokedAt: 'text',
  local: 'boolean',
};

const SPEC: StoreSpec<typeof DeviceSchema, typeof DeviceInputSchema, typeof DevicePatchSchema> = {
  table: 'devices',
  schema: DeviceSchema,
  input: DeviceInputSchema,
  patch: DevicePatchSchema,
  columns: COLUMNS,
  defaults: { local: false },
};

export function createDeviceStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    create: (input: DeviceInput): Device => store.create(input),
    get: store.get.bind(store),
    require: store.require.bind(store),
    /** Newest first; revoked devices stay in the list so the user sees what was revoked and when. */
    list: (page: Page = {}): Device[] => store.select('1 = 1', {}, page, 'created_at DESC, id DESC'),
    touch(id: string, at: string): Device {
      const current = store.require(id);
      return store.update(id, current.version, { lastSeenAt: at });
    },
    /** Revoking twice keeps the first time. */
    revoke(id: string, at: string): Device {
      const current = store.require(id);
      if (current.revokedAt !== null) {
        return current;
      }
      return store.update(id, current.version, { revokedAt: at });
    },
  };
}

export type DeviceStore = ReturnType<typeof createDeviceStore>;
