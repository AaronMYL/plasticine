import { AskInputSchema, AskPatchSchema, AskSchema, type Ask, type AskInput } from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  kind: 'text',
  purpose: 'text',
  channel: 'text',
  question: 'text',
  detail: 'text',
  options: 'json',
  taskId: 'text',
  runId: 'text',
  actionId: 'text',
  context: 'json',
  status: 'text',
  answer: 'json',
  answeredAt: 'text',
  answeredByDeviceId: 'text',
  deferredAt: 'text',
  withdrawnAt: 'text',
  feedback: 'text',
  feedbackAt: 'text',
  basis: 'text',
};

const SPEC: StoreSpec<typeof AskSchema, typeof AskInputSchema, typeof AskPatchSchema> = {
  table: 'asks',
  schema: AskSchema,
  input: AskInputSchema,
  patch: AskPatchSchema,
  columns: COLUMNS,
  defaults: { status: 'open' },
};

export function createAskStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    create: (input: AskInput): Ask => store.create(input),
    get: store.get.bind(store),
    collisionDismissed(judgmentId: string, version: number): boolean {
      return store.select("purpose = 'collision' AND json_extract(context, '$.judgmentId') = $judgmentId "
        + "AND json_extract(context, '$.judgmentVersion') = $version "
        + "AND json_extract(answer, '$.optionId') = 'abandon'",
      { judgmentId, version }, { limit: 1 }).length > 0;
    },
    require: store.require.bind(store),
    update: store.update.bind(store),
    byActionId: (actionId: string): Ask | undefined =>
      store.select('action_id = $action_id', { action_id: actionId })[0],
    /** Every open card, oldest first. */
    open: (): Ask[] => allPages((page) => store.list({ status: 'open' }, page)),
    between: (from: string, to: string): Ask[] => allPages((page) => store.select(
      'created_at >= $from AND created_at < $to', { from, to }, page)),
    closedSince: (since: string, limit: number): Ask[] => store.select(
      "status != 'open' AND created_at >= $since", { since }, { limit }, 'created_at DESC, id DESC'),
  };
}

export type AskStore = ReturnType<typeof createAskStore>;
