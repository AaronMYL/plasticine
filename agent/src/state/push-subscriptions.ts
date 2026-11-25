import {
  PushSubscriptionInputSchema,
  PushSubscriptionPatchSchema,
  PushSubscriptionSchema,
  type PushSubscription,
  type PushSubscriptionInput,
  type PushSubscriptionPatch,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  deviceId: 'text',
  endpoint: 'text',
  p256dh: 'text',
  auth: 'text',
  revokedAt: 'text',
  lastSentAt: 'text',
  lastError: 'text',
  generation: 'integer',
};

type Spec = StoreSpec<
  typeof PushSubscriptionSchema,
  typeof PushSubscriptionInputSchema,
  typeof PushSubscriptionPatchSchema
>;
const SPEC: Spec = {
  table: 'push_subscriptions',
  schema: PushSubscriptionSchema,
  input: PushSubscriptionInputSchema,
  patch: PushSubscriptionPatchSchema,
  columns: COLUMNS,
  defaults: { generation: 1 },
};

export function createPushSubscriptionStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);

  function byEndpoint(endpoint: string): PushSubscription | undefined {
    return store.select('endpoint = $endpoint', { endpoint })[0];
  }

  return {
    get: store.get.bind(store),
    byEndpoint,
    /** Subscribes, or re-enables the endpoint's row with the keys and device it comes with now. */
    upsert(input: PushSubscriptionInput): PushSubscription {
      return context.db.transaction(() => {
        const existing = byEndpoint(input.endpoint);
        if (existing === undefined) {
          return store.create(input);
        }
        const patch: PushSubscriptionPatch = {
          deviceId: input.deviceId,
          p256dh: input.p256dh,
          auth: input.auth,
          revokedAt: null,
          lastError: null,
          generation: existing.generation + 1,
        };
        return store.update(existing.id, existing.version, patch);
      });
    },
    /** Revoking twice keeps the first time; an unknown endpoint is undefined. */
    revoke(endpoint: string, at: string): PushSubscription | undefined {
      return context.db.transaction(() => {
        const existing = byEndpoint(endpoint);
        if (existing === undefined || existing.revokedAt !== null) {
          return existing;
        }
        return store.update(existing.id, existing.version, { revokedAt: at, generation: existing.generation + 1 });
      });
    },
    record(
      id: string,
      generation: number,
      patch: Pick<PushSubscriptionPatch, 'lastSentAt' | 'lastError' | 'revokedAt'>,
    ): PushSubscription | undefined {
      return context.db.transaction(() => {
        const current = store.require(id);
        return current.generation === generation ? store.update(id, current.version, patch) : undefined;
      });
    },
    /** Every subscription still in use, oldest first. */
    active: (): PushSubscription[] => allPages((page) => store.list({ revokedAt: null }, page)),
  };
}

export type PushSubscriptionStore = ReturnType<typeof createPushSubscriptionStore>;
