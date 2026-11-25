import {
  SuggestionInputSchema,
  SuggestionPatchSchema,
  SuggestionSchema,
  type Suggestion,
  type SuggestionInput,
  type SuggestionPatch,
} from '../../shared/state.ts';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  title: 'text',
  why: 'text',
  goal: 'text',
  projectId: 'text',
  source: 'text',
  icon: 'text',
  key: 'text',
  sourceRef: 'text',
  status: 'text',
  lineId: 'text',
  todoId: 'text',
  actedAt: 'text',
  actedByDeviceId: 'text',
};

const SPEC: StoreSpec<typeof SuggestionSchema, typeof SuggestionInputSchema, typeof SuggestionPatchSchema> = {
  table: 'suggestions',
  schema: SuggestionSchema,
  input: SuggestionInputSchema,
  patch: SuggestionPatchSchema,
  columns: COLUMNS,
  defaults: { status: 'open', lineId: null, todoId: null, actedAt: null, actedByDeviceId: null },
};

export function createSuggestionStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    create: (input: SuggestionInput): Suggestion => store.create(input),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: (id: string, version: number, patch: SuggestionPatch): Suggestion => store.update(id, version, patch),
    open: (): Suggestion[] => allPages((page) =>
      store.select("status = 'open'", {}, page, 'created_at DESC, id DESC')),
    byKey: (key: string): Suggestion | undefined =>
      store.select('key = $key', { key }, { limit: 1 }, 'created_at DESC, id DESC')[0],
  };
}

export type SuggestionStore = ReturnType<typeof createSuggestionStore>;
