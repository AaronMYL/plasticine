import { Type, type Static } from 'typebox';
import { MEMORY_LINE_SECTIONS } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };
export const MEMORY_LAYERS_MOVE_PATH = `${API_PREFIX}/memory/layers-move`;
export const MEMORY_LAYERS_MOVE_UNDO_PATH = `${MEMORY_LAYERS_MOVE_PATH}/undo`;

export const LayersMoveItemSchema = Type.Object({
  lineId: IdSchema,
  text: Type.String(),
  toDocId: IdSchema,
  toTitle: Type.String(),
  section: Type.Enum(MEMORY_LINE_SECTIONS),
  fromTitle: OrNull(Type.String()),
}, STRICT);
export type LayersMoveItemView = Static<typeof LayersMoveItemSchema>;

export const LayersMoveViewSchema = Type.Object({
  at: IsoTimeSchema,
  items: Type.Array(LayersMoveItemSchema),
  kept: Type.Integer({ minimum: 0 }),
}, STRICT);
export type LayersMoveView = Static<typeof LayersMoveViewSchema>;

export const LayersMoveResponseSchema = Type.Object({ move: OrNull(LayersMoveViewSchema) }, STRICT);
export type LayersMoveResponse = Static<typeof LayersMoveResponseSchema>;

export const UndoLayersMoveRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  lineIds: Type.Optional(Type.Array(IdSchema, { minItems: 1, maxItems: 300 })),
}, STRICT);
export type UndoLayersMoveRequest = Static<typeof UndoLayersMoveRequestSchema>;
