// Web Push 订阅（第 91 条 ⑤）：一个 endpoint 一行。退订和推送服务说「这个订阅没了」都只打 revoked_at；同一 endpoint
// 再订阅时这一行换上新的钥匙、重新启用。p256dh / auth 是浏览器给的加密参数，只在这里和加密时用，不进日志。

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
    /**
     * What a send to the subscription of `generation` came to. Another send's result does not change the generation
     * (d2923e7 审查 P2); a response that comes back after you subscribed again or unsubscribed is about the old
     * subscription: it is dropped, undefined (14b23fd 审查 P2).
     */
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
