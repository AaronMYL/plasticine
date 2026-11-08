// 设备的长期会话（第 90 条 ②）：只存令牌的散列。登出和撤销设备都只打撤销时间，不删行，留着可查。

import {
  SessionInputSchema,
  SessionPatchSchema,
  SessionSchema,
  type Session,
  type SessionInput,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { MAX_PAGE_SIZE, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  tokenHash: 'text',
  deviceId: 'text',
  expiresAt: 'text',
  lastSeenAt: 'text',
  revokedAt: 'text',
};

const SPEC: StoreSpec<typeof SessionSchema, typeof SessionInputSchema, typeof SessionPatchSchema> = {
  table: 'sessions',
  schema: SessionSchema,
  input: SessionInputSchema,
  patch: SessionPatchSchema,
  columns: COLUMNS,
  defaults: {},
};

export function createSessionStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);

  function revoke(id: string, at: string): Session {
    const current = store.require(id);
    if (current.revokedAt !== null) {
      return current;
    }
    return store.update(id, current.version, { revokedAt: at });
  }

  return {
    create: (input: SessionInput): Session => store.create(input),
    get: store.get.bind(store),
    findByTokenHash(tokenHash: string): Session | undefined {
      return store.select('token_hash = $token_hash', { token_hash: tokenHash })[0];
    },
    touch(id: string, at: string): Session {
      const current = store.require(id);
      return store.update(id, current.version, { lastSeenAt: at });
    },
    revoke,
    /** Every session of the device that is still open; a device has a handful at most (one per pairing). */
    revokeForDevice(deviceId: string, at: string): Session[] {
      return context.db.transaction(() => {
        const open = store.select(
          'device_id = $device_id AND revoked_at IS NULL',
          { device_id: deviceId },
          { limit: MAX_PAGE_SIZE },
        );
        return open.map((session) => revoke(session.id, at));
      });
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
