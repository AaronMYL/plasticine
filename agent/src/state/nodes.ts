// 执行节点（M5 设备服务）：配对时登记，长期凭证只存散列；撤销只打时间，不删行。上限是用户确认字段：普通写入碰不到
// （limits / limitsVersion 只认 null / 0 这个「还在用默认上限」），只有 confirm 带着设备确认能写。
// 规则（码有没有过期、上限怎么查）在 devices/，这里只存取。

import {
  NodeConfirmedSchema,
  NodeInputSchema,
  NodePatchSchema,
  NodeSchema,
  type DeviceConfirmation,
  type DeviceNode,
  type NodeConfirmed,
  type NodeInput,
  type NodePatch,
  type Page,
} from '../../shared/state.ts';
import { CONFIRMATION_META_COLUMNS, RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  name: 'text',
  platform: 'text',
  appVersion: 'text',
  protocolVersion: 'integer',
  capabilities: 'json',
  credentialHash: 'text',
  pairingCodeId: 'text',
  pairedAt: 'text',
  lastSeenAt: 'text',
  revokedAt: 'text',
  limits: 'json',
  limitsVersion: 'integer',
  idleSeconds: 'integer',
  idleReportedAt: 'text',
  ...CONFIRMATION_META_COLUMNS,
};

const SPEC: StoreSpec<typeof NodeSchema, typeof NodeInputSchema, typeof NodePatchSchema, typeof NodeConfirmedSchema> =
  {
    table: 'nodes',
    schema: NodeSchema,
    input: NodeInputSchema,
    patch: NodePatchSchema,
    confirmedInput: NodeConfirmedSchema,
    columns: COLUMNS,
    defaults: { limits: null, limitsVersion: 0, idleSeconds: null, idleReportedAt: null },
    confirmed: [
      { field: 'limits', freeValues: [null] },
      { field: 'limitsVersion', freeValues: [0] },
    ],
  };

export function createNodeStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    create: (input: NodeInput): DeviceNode => store.create(input),
    get: store.get.bind(store),
    require: store.require.bind(store),
    /** Newest first; revoked nodes stay listed so the user sees what was revoked and when. */
    list: (page: Page = {}): DeviceNode[] => store.select('1 = 1', {}, page, 'created_at DESC, id DESC'),
    findByCredentialHash(credentialHash: string): DeviceNode | undefined {
      return store.select('credential_hash = $credential_hash', { credential_hash: credentialHash })[0];
    },
    update: (id: string, expectedVersion: number, patch: NodePatch): DeviceNode =>
      store.update(id, expectedVersion, patch),
    /** The only way limits change: a request signed on one of the user's paired devices (app/ checks the signature). */
    confirmLimits(id: string, expectedVersion: number, fields: NodeConfirmed, confirmation: DeviceConfirmation) {
      return store.confirm(id, expectedVersion, fields, confirmation, '你在设备上改了这台节点的上限');
    },
  };
}

export type NodeStore = ReturnType<typeof createNodeStore>;
