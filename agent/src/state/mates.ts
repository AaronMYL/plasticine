import { Type, type Static } from 'typebox';
import { MateDraftSchema, MateViewSchema, MateGroupDraftSchema, MateGroupViewSchema,
  type MateGroupView } from '../../shared/api/mates.ts';
import { DEFAULT_MATE_FACE, DEFAULT_MATE_VARIANT } from '../../shared/api/mate-characters.ts';
import { IdSchema, IsoTimeSchema } from '../../shared/api/common.ts';
import { RECORD_META_COLUMNS } from './codec.ts';
import { StateError } from './errors.ts';
import { allPages, ObjectStore, type StoreContext } from './object-store.ts';

const NullableDate = Type.Union([IsoTimeSchema, Type.Null()]);
const MateInput = Type.Object({ ...MateDraftSchema.properties, lineId: IdSchema }, { additionalProperties: false });
const MatePatch = Type.Partial(Type.Object({ ...MateDraftSchema.properties, disabledAt: NullableDate },
  { additionalProperties: false }));
const GroupInput = Type.Object({ ...MateGroupDraftSchema.properties, lineId: IdSchema },
  { additionalProperties: false });
const GroupPatch = Type.Partial(MateGroupDraftSchema);

export function createMateStores(context: StoreContext) {
  const mates = new ObjectStore(context, { table: 'mates', schema: MateViewSchema,
    input: MateInput, patch: MatePatch,
    columns: { ...RECORD_META_COLUMNS, name: 'text', avatar: 'text', hue: 'text', variant: 'text', face: 'text',
      role: 'text', soul: 'text', purpose: 'text', lineId: 'text', disabledAt: 'text' },
    defaults: { variant: DEFAULT_MATE_VARIANT, face: DEFAULT_MATE_FACE, disabledAt: null } });
  const groups = new ObjectStore(context, { table: 'mate_groups', schema: MateGroupViewSchema,
    input: GroupInput, patch: GroupPatch,
    columns: { ...RECORD_META_COLUMNS, name: 'text', mateIds: 'json', lineId: 'text' }, defaults: {} });
  const requireMembers = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (mates.get(id)?.disabledAt !== null) throw new StateError('invalid_input', '只能选择在用的队友。');
    }
  };
  return {
    mates: {
      get: (id: string) => mates.get(id),
      require: (id: string) => mates.require(id),
      all: () => allPages((page) => mates.select('1', {}, page, 'created_at, id')),
      active: () => allPages((page) => mates.select('disabled_at IS NULL', {}, page, 'created_at, id')),
      create: (input: Static<typeof MateInput>) => mates.create(input),
      update: (id: string, version: number, patch: Static<typeof MatePatch>) => mates.update(id, version, patch),
    },
    mateGroups: {
      get: (id: string) => groups.get(id),
      require: (id: string) => groups.require(id),
      all: () => allPages((page) => groups.select('1', {}, page, 'created_at, id')),
      create(input: Static<typeof GroupInput>): MateGroupView {
        requireMembers(input.mateIds);
        return groups.create(input);
      },
      update(id: string, version: number, patch: Static<typeof GroupPatch>): MateGroupView {
        if (patch.mateIds !== undefined) requireMembers(patch.mateIds);
        return groups.update(id, version, patch);
      },
    },
  };
}
