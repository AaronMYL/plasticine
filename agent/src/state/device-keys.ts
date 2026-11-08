// 设备签名钥匙（第 90 条 ②）：设备在浏览器里生成不可导出的 ECDSA P-256 钥匙，这里只存它的公钥。一台设备同时
// 只有一把现行钥匙，同一把现行钥匙不能登记给两台设备（库里的部分唯一索引兜底）。撤销只打时间，不删行。
// 验签是 app/ 的事；这里只存取。

import {
  DeviceKeyInputSchema,
  DeviceKeyPatchSchema,
  DeviceKeySchema,
  type DeviceKey,
  type DeviceKeyInput,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  deviceId: 'text',
  publicKey: 'json',
  thumbprint: 'text',
  revokedAt: 'text',
};

const SPEC: StoreSpec<typeof DeviceKeySchema, typeof DeviceKeyInputSchema, typeof DeviceKeyPatchSchema> = {
  table: 'device_keys',
  schema: DeviceKeySchema,
  input: DeviceKeyInputSchema,
  patch: DeviceKeyPatchSchema,
  columns: COLUMNS,
  defaults: {},
};

export function createDeviceKeyStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);

  function liveFor(deviceId: string): DeviceKey | undefined {
    return store.select('device_id = $device_id AND revoked_at IS NULL', { device_id: deviceId }, { limit: 1 })[0];
  }

  return {
    /** A device that already has a live key, or a key live on another device, is a `duplicate`. */
    register: (input: DeviceKeyInput): DeviceKey => store.create(input),
    get: store.get.bind(store),
    liveFor,
    liveByThumbprint(thumbprint: string): DeviceKey | undefined {
      return store.select('thumbprint = $thumbprint AND revoked_at IS NULL', { thumbprint }, { limit: 1 })[0];
    },
    /** A revoked device's key signs nothing any more; revoking it lets the same browser key pair again. */
    revokeForDevice(deviceId: string, at: string): DeviceKey | undefined {
      const live = liveFor(deviceId);
      return live === undefined ? undefined : store.update(live.id, live.version, { revokedAt: at });
    },
    /** Revoking twice keeps the first time. */
    revoke(id: string, at: string): DeviceKey {
      const current = store.require(id);
      if (current.revokedAt !== null) {
        return current;
      }
      return store.update(id, current.version, { revokedAt: at });
    },
  };
}

export type DeviceKeyStore = ReturnType<typeof createDeviceKeyStore>;
