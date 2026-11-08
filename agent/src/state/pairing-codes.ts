// 一次性配对码（第 90 条 ②）：只存散列。用过一次就记下用的时间和设备，之后同一个码再来也换不到会话。
// 有效期和「过期 / 用过」的判断在 app/，这里只存取，并保证同一个码只能被记一次使用。

import {
  PairingCodeInputSchema,
  PairingCodePatchSchema,
  PairingCodeSchema,
  type PairingCode,
  type PairingCodeInput,
  type PairingCodePatch,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { StateError } from './errors.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  codeHash: 'text',
  expiresAt: 'text',
  usedAt: 'text',
  deviceId: 'text',
};

const SPEC: StoreSpec<typeof PairingCodeSchema, typeof PairingCodeInputSchema, typeof PairingCodePatchSchema> = {
  table: 'pairing_codes',
  schema: PairingCodeSchema,
  input: PairingCodeInputSchema,
  patch: PairingCodePatchSchema,
  columns: COLUMNS,
  defaults: {},
};

export function createPairingCodeStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    issue: (input: PairingCodeInput): PairingCode => store.create(input),
    get: store.get.bind(store),
    findByHash(codeHash: string): PairingCode | undefined {
      return store.select('code_hash = $code_hash', { code_hash: codeHash })[0];
    },
    /** Records the one use of a code; a code that was already used is refused, never used twice. */
    markUsed(id: string, use: PairingCodePatch): PairingCode {
      return context.db.transaction(() => {
        const current = store.require(id);
        if (current.usedAt !== null) {
          throw new StateError('duplicate', `配对码 ${id} 已经在 ${current.usedAt} 用过`);
        }
        return store.update(id, current.version, use);
      });
    },
  };
}

export type PairingCodeStore = ReturnType<typeof createPairingCodeStore>;
