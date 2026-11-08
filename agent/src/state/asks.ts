// 要你定卡（《UI 方案》第 6 节）：一张卡一行，答过、先不、撤回都只改这一行，不删。哪张摊开、怎么排、被答之后做什么
// 是 attention/ 和 execution/ 的事，这里只存取。同一个动作（action_id）只出一张卡。

import {
  AskInputSchema,
  AskPatchSchema,
  AskSchema,
  type Ask,
  type AskInput,
  type Page,
} from '../../shared/state.ts';
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
  };
}

export type AskStore = ReturnType<typeof createAskStore>;
