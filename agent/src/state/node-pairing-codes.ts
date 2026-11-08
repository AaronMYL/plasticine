// 节点的一次性配对码（M5）：App 上签名领一个，节点输入一次。只存散列；用一次就记下节点，作废（同一次领码请求重发换了新码）
// 只打时间。有效期和「过期 / 用过 / 作废」的判断在 devices/。

import {
  NodePairingCodeInputSchema,
  NodePairingCodePatchSchema,
  NodePairingCodeSchema,
  type NodePairingCode,
  type NodePairingCodeInput,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { StateError } from './errors.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  codeHash: 'text',
  expiresAt: 'text',
  issuedByDeviceId: 'text',
  usedAt: 'text',
  nodeId: 'text',
  voidedAt: 'text',
};

const SPEC: StoreSpec<
  typeof NodePairingCodeSchema,
  typeof NodePairingCodeInputSchema,
  typeof NodePairingCodePatchSchema
> = {
  table: 'node_pairing_codes',
  schema: NodePairingCodeSchema,
  input: NodePairingCodeInputSchema,
  patch: NodePairingCodePatchSchema,
  columns: COLUMNS,
  defaults: {},
};

export function createNodePairingCodeStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    issue: (input: NodePairingCodeInput): NodePairingCode => store.create(input),
    get: store.get.bind(store),
    findByHash(codeHash: string): NodePairingCode | undefined {
      return store.select('code_hash = $code_hash', { code_hash: codeHash })[0];
    },
    /** A code is used once; a used or voided code is refused here as well, never used twice. */
    markUsed(id: string, usedAt: string, nodeId: string): NodePairingCode {
      return context.db.transaction(() => {
        const current = store.require(id);
        if (current.usedAt !== null || current.voidedAt !== null) {
          throw new StateError('duplicate', `节点配对码 ${id} 已经用过或作废了`);
        }
        return store.update(id, current.version, { usedAt, nodeId });
      });
    },
    /** Voiding twice keeps the first time; a used code stays used. */
    void(id: string, at: string): NodePairingCode {
      const current = store.require(id);
      if (current.voidedAt !== null || current.usedAt !== null) {
        return current;
      }
      return store.update(id, current.version, { voidedAt: at });
    },
  };
}

export type NodePairingCodeStore = ReturnType<typeof createNodePairingCodeStore>;
