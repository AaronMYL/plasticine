// 订阅的存取（《优化清单》第 6、7 条）：订阅就是任务设置；每一期是一个空间（spaces.subscription_id）。
// 什么时候能开定时、改设置合不合规，由 subs/ 判断；这里只存。

import {
  SubscriptionInputSchema,
  SubscriptionPatchSchema,
  SubscriptionSchema,
  type Subscription,
  type SubscriptionInput,
  type SubscriptionPatch,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  title: 'text',
  kind: 'text',
  status: 'text',
  settings: 'json',
  timeZone: 'text',
  lineId: 'text',
  lastRunAt: 'text',
};

const SPEC: StoreSpec<typeof SubscriptionSchema, typeof SubscriptionInputSchema, typeof SubscriptionPatchSchema> = {
  table: 'space_subscriptions',
  schema: SubscriptionSchema,
  input: SubscriptionInputSchema,
  patch: SubscriptionPatchSchema,
  columns: COLUMNS,
  defaults: { lineId: null, lastRunAt: null },
};

export function createSubscriptionStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    create: (input: SubscriptionInput, options: { id?: string } = {}): Subscription =>
      store.create(input, undefined, options.id === undefined ? {} : { id: options.id }),
    get: (id: string): Subscription | undefined => store.get(id),
    require: (id: string): Subscription => store.require(id),
    update: (id: string, version: number, patch: SubscriptionPatch): Subscription => store.update(id, version, patch),
    /** 全部订阅：个人回顾在前，其余按建的先后。 */
    all: (): Subscription[] => allPages((page) => store.select('1 = 1', {}, page,
      "CASE kind WHEN 'review' THEN 0 ELSE 1 END, created_at, id")),
  };
}

export type SubscriptionStore = ReturnType<typeof createSubscriptionStore>;
