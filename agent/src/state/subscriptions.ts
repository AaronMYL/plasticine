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
    all: (): Subscription[] => allPages((page) => store.select('1 = 1', {}, page,
      "CASE kind WHEN 'review' THEN 0 ELSE 1 END, created_at, id")),
  };
}

export type SubscriptionStore = ReturnType<typeof createSubscriptionStore>;
